// Servidor de salas + posições em tempo real (WebSocket) e arquivos estáticos do jogo.
// Deploy: Render (Web Service, `npm start`). Local: `npm start` → http://localhost:8000
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8000;
const STATIC_DIR = path.join(__dirname, '..');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['green', 'beige', 'pink', 'purple', 'yellow'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain' };

// ---------- estado ----------
const rooms = new Map();   // code -> { code, name, visibility, passHash, createdBy, createdAt, players: Map<id, client> }
const clients = new Map(); // id -> { id, ws, nick, color, room, x, y, f, a }

const makeCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const hashPass = (code, pass) => crypto.createHash('sha256').update(code + ':' + pass).digest('hex');
const cleanText = (s, max) => String(s ?? '').replace(/[^\p{L}\p{N} _.!?'-]/gu, '').trim().slice(0, max);
const send = (c, type, data) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ type, ...data })); };

// Todas as salas aparecem na lista; as privadas com senha pedem a senha ao entrar.
function publicRooms() {
  return [...rooms.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({ code: r.code, name: r.name, visibility: r.visibility, hasPassword: !!r.passHash, count: r.players.size, createdBy: r.createdBy, createdAt: r.createdAt }));
}
function broadcastRooms() {
  const list = publicRooms();
  for (const c of clients.values()) if (!c.room) send(c, 'rooms', { rooms: list });
}
function broadcastRoom(room, type, data, except) {
  for (const p of room.players.values()) if (p !== except) send(p, type, data);
}
const playerView = (c) => ({ id: c.id, nick: c.nick, color: c.color, x: c.x, y: c.y, f: c.f, a: c.a });

function leaveRoom(c, notify = true) {
  const room = c.room;
  if (!room) return;
  room.players.delete(c.id);
  c.room = null;
  broadcastRoom(room, 'player_leave', { id: c.id });
  if (room.players.size === 0) rooms.delete(room.code); // a sala morre com o último jogador
  if (notify) send(c, 'rooms', { rooms: publicRooms() });
  broadcastRooms();
}

function joinRoom(c, room) {
  leaveRoom(c, false);
  c.room = room;
  // nasce ao lado de alguém que já esteja na sala
  const others = [...room.players.values()];
  if (others.length) {
    const o = others[Math.floor(Math.random() * others.length)];
    c.x = o.x + (Math.random() < 0.5 ? -90 : 90);
  } else c.x = null; // cliente decide (meio do mapa)
  c.y = null; c.f = 1; c.a = 'i';
  room.players.set(c.id, c);
  send(c, 'joined', { code: room.code, name: room.name, visibility: room.visibility, spawnX: c.x, players: others.map(playerView) });
  broadcastRoom(room, 'player_join', { player: playerView(c) }, c);
  broadcastRooms();
}

// ---------- mensagens ----------
const handlers = {
  hello(c, m) {
    c.nick = cleanText(m.nick, 16) || 'Jogador';
    c.color = COLORS.includes(m.color) ? m.color : COLORS[Math.floor(Math.random() * COLORS.length)];
    send(c, 'welcome', { id: c.id, color: c.color });
    send(c, 'rooms', { rooms: publicRooms() });
  },
  list(c) { send(c, 'rooms', { rooms: publicRooms() }); },
  create(c, m) {
    const name = cleanText(m.name, 32);
    if (!name) return send(c, 'error', { ctx: 'create', msg: 'Dê um nome para a sala.' });
    const visibility = m.visibility === 'private' ? 'private' : 'public';
    const pass = visibility === 'private' ? String(m.password || '').slice(0, 32) : '';
    let code; do code = makeCode(); while (rooms.has(code));
    const room = { code, name, visibility, passHash: pass ? hashPass(code, pass) : null, createdBy: c.nick, createdAt: Date.now(), players: new Map() };
    rooms.set(code, room);
    joinRoom(c, room);
  },
  join(c, m) {
    const code = String(m.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return send(c, 'error', { ctx: 'join', msg: 'Sala não encontrada. Confira o código.' });
    if (room.passHash && hashPass(code, String(m.password || '')) !== room.passHash) return send(c, 'error', { ctx: 'join', msg: 'Senha incorreta.' });
    joinRoom(c, room);
  },
  leave(c) { leaveRoom(c); },
  state(c, m) {
    if (!c.room) return;
    c.x = Number(m.x) || 0; c.y = Number(m.y) || 0;
    c.f = m.f === -1 ? -1 : 1;
    c.a = ['i', 'w', 'j'].includes(m.a) ? m.a : 'i';
    broadcastRoom(c.room, 'state', { id: c.id, x: c.x, y: c.y, f: c.f, a: c.a }, c);
  },
};

// ---------- http + ws ----------
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok ' + (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7)); }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(STATIC_DIR, p));
  if (!file.startsWith(STATIC_DIR) || file.includes(path.sep + '_download') || file.includes(path.sep + 'server' + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
let nextId = 1;
wss.on('connection', (ws) => {
  const c = { id: String(nextId++), ws, nick: 'Jogador', color: 'green', room: null, x: 0, y: 0, f: 1, a: 'i', alive: true };
  clients.set(c.id, c);
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', (raw) => {
    if (raw.length > 4096) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    const h = handlers[m && m.type];
    if (h) h(c, m);
  });
  ws.on('close', () => { leaveRoom(c, false); clients.delete(c.id); });
  ws.on('error', () => {});
});

// keepalive (Render fecha conexões ociosas)
setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false; c.ws.ping();
  }
}, 15_000);

server.listen(PORT, () => console.log(`Colinas Verdes: http://localhost:${PORT}`));
