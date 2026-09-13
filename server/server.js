// Servidor de salas + posições em tempo real (WebSocket) e arquivos estáticos do jogo.
// Deploy: Render (Web Service, `npm start`). Local: `npm start` → http://localhost:8000
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Level = require('../level.js');

const PORT = process.env.PORT || 8000;
const STATIC_DIR = path.join(__dirname, '..');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['green', 'beige', 'pink', 'purple', 'yellow'];
// nome aleatório para salas criadas sem nome
const ROOM_ADJ = ['Verde', 'Azul', 'Dourada', 'Secreta', 'Alegre', 'Ventosa', 'Alta', 'Tranquila', 'Veloz', 'Nublada', 'Ensolarada', 'Pequena'];
const ROOM_NOUN = ['Colina', 'Trilha', 'Clareira', 'Pradaria', 'Encosta', 'Campina', 'Várzea', 'Ladeira', 'Planície', 'Ilha'];
const randomRoomName = () => `${ROOM_NOUN[Math.floor(Math.random() * ROOM_NOUN.length)]} ${ROOM_ADJ[Math.floor(Math.random() * ROOM_ADJ.length)]}`;
const COUNTDOWN_MS = 4000;      // contagem regressiva antes da largada
const RESULTS_MS = 5000;        // placar na tela antes da próxima corrida
const FINISH_GRACE_MS = 15000;  // depois que o primeiro chega, os outros têm este tempo
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain' };

// ---------- estado ----------
const rooms = new Map();   // code -> { code, name, visibility, passHash, createdBy, createdAt, players: Map<id, client>, race }
const clients = new Map(); // id -> { id, ws, nick, color, room, x, y, f, a }

const makeCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const hashPass = (code, pass) => crypto.createHash('sha256').update(code + ':' + pass).digest('hex');
const cleanText = (s, max) => String(s ?? '').replace(/[^\p{L}\p{N} _.!?'-]/gu, '').trim().slice(0, max);
const send = (c, type, data) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ type, ...data })); };

// Todas as salas aparecem na lista; as privadas com senha pedem a senha ao entrar.
function publicRooms() {
  return [...rooms.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({ code: r.code, name: r.name, visibility: r.visibility, mode: r.mode || 'race', hasPassword: !!r.passHash, count: r.players.size, createdBy: r.createdBy, createdAt: r.createdAt }));
}
function broadcastRooms() {
  const list = publicRooms();
  for (const c of clients.values()) if (!c.room) send(c, 'rooms', { rooms: list });
}
function broadcastRoom(room, type, data, except) {
  for (const p of room.players.values()) if (p !== except) send(p, type, data);
}
const playerView = (c) => ({ id: c.id, nick: c.nick, color: c.color, hero: c.hero || '', x: c.x, y: c.y, f: c.f, a: c.a });

// ---------- corrida ----------
// Cada sala tem uma corrida: seed (fase), startAt (largada), fase 'racing' ou 'results'.
// A corrida acaba quando o penúltimo cruza a chegada (com 1 ou 2 jogadores, quando o primeiro cruza).
function raceView(room) {
  const r = room.race;
  return { seed: r.seed, startAt: r.startAt, phase: r.phase, results: r.results || null, nextAt: r.nextAt || null, finished: r.finished.length, broken: [...r.broken], activated: [...r.activated], endsAt: r.endsAt || null, now: Date.now() };
}
function startRace(room, except) {
  clearTimeout(room.nextTimer);
  if (room.race) clearTimeout(room.race.graceTimer);
  const seed = crypto.randomInt(1, 2 ** 31);
  const level = Level.generate(seed);
  room.race = { seed, level, finishX: level.finishX, startAt: Date.now() + COUNTDOWN_MS, phase: 'racing', finished: [], results: null, nextAt: null, broken: new Set(), activated: new Set(), taken: new Set(), endsAt: null, graceTimer: null };
  for (const p of room.players.values()) { p.finished = false; p.x = level.spawnX; p.y = level.spawnY; }
  broadcastRoom(room, 'race_start', raceView(room), except);
}
function checkRaceEnd(room) {
  const r = room.race;
  if (!r || r.phase !== 'racing') return;
  const n = room.players.size;
  if (n === 0) return;
  if (r.finished.length >= Math.max(1, n - 1)) endRace(room);
}
function endRace(room) {
  const r = room.race;
  clearTimeout(r.graceTimer);
  r.phase = 'results';
  const done = new Set(r.finished.map((f) => f.id));
  const rest = [...room.players.values()].filter((p) => !done.has(p.id)).map((p) => ({ id: p.id, nick: p.nick, color: p.color, time: null, coins: p.coins || 0 }));
  r.results = [...r.finished, ...rest];
  r.nextAt = Date.now() + RESULTS_MS;
  broadcastRoom(room, 'race_end', raceView(room));
  room.nextTimer = setTimeout(() => { if (rooms.has(room.code) && room.players.size > 0) startRace(room); }, RESULTS_MS);
}

function leaveRoom(c, notify = true) {
  const room = c.room;
  if (!room) return;
  room.players.delete(c.id);
  c.room = null;
  broadcastRoom(room, 'player_leave', { id: c.id });
  if (room.players.size === 0) { clearTimeout(room.nextTimer); if (room.race) clearTimeout(room.race.graceTimer); rooms.delete(room.code); } // a sala morre com o último jogador
  else checkRaceEnd(room);
  if (notify) send(c, 'rooms', { rooms: publicRooms() });
  broadcastRooms();
}

function joinRoom(c, room) {
  leaveRoom(c, false);
  c.room = room;
  const others = [...room.players.values()];
  c.x = 96; c.y = Level.GROUND * Level.TILE; c.f = 1; c.a = 'i'; c.finished = false; c.coins = 0;
  room.players.set(c.id, c);
  if (!room.race) startRace(room, c); // o criador recebe a corrida no 'joined'
  // quem estava sozinho ganha companhia: recomeça a corrida para os dois largarem juntos
  else if (room.players.size === 2 && room.race.phase === 'racing') startRace(room, c);
  send(c, 'joined', { code: room.code, name: room.name, visibility: room.visibility, players: others.map(playerView), race: raceView(room) });
  broadcastRoom(room, 'player_join', { player: playerView(c) }, c);
  broadcastRooms();
}

// ---------- mensagens ----------
const handlers = {
  hello(c, m) {
    c.nick = cleanText(m.nick, 16) || 'Jogador';
    c.color = COLORS.includes(m.color) ? m.color : COLORS[Math.floor(Math.random() * COLORS.length)];
    c.hero = typeof m.hero === 'string' && m.hero.length <= 600 && m.hero.startsWith('{') ? m.hero : ''; // config do personagem (JSON), validada no cliente
    send(c, 'welcome', { id: c.id, color: c.color });
    send(c, 'rooms', { rooms: publicRooms() });
    if (c.room) broadcastRoom(c.room, 'player_update', { id: c.id, nick: c.nick, color: c.color, hero: c.hero }, c); // mudou o personagem/apelido dentro da sala
  },
  list(c) { send(c, 'rooms', { rooms: publicRooms() }); },
  ping(c, m) { send(c, 'pong', { t0: Number(m.t0) || 0, server: Date.now() }); },
  create(c, m) {
    const name = cleanText(m.name, 32) || randomRoomName();
    const visibility = m.visibility === 'private' ? 'private' : 'public';
    const mode = ['race'].includes(m.mode) ? m.mode : 'race'; // modos de jogo (por enquanto só a corrida)
    const pass = visibility === 'private' ? String(m.password || '').slice(0, 32) : '';
    let code; do code = makeCode(); while (rooms.has(code));
    const room = { code, name, visibility, mode, passHash: pass ? hashPass(code, pass) : null, createdBy: c.nick, createdAt: Date.now(), players: new Map(), race: null, nextTimer: null };
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
    c.a = ['i', 'w', 'j', 'h'].includes(m.a) ? m.a : 'i';
    broadcastRoom(c.room, 'state', { id: c.id, x: c.x, y: c.y, f: c.f, a: c.a }, c);
  },
  // mundo compartilhado: primeiro que pisa quebra a caixa / ativa o bloco; primeiro que encosta leva o item
  break(c, m) {
    const room = c.room; if (!room || !room.race || room.race.phase !== 'racing') return;
    const r = Number(m.r), col = Number(m.c), key = r + ',' + col;
    const cell = (room.race.level.cells[r] && room.race.level.cells[r][col]) || null;
    if (!cell || !cell.crate || room.race.broken.has(key)) return;
    room.race.broken.add(key);
    broadcastRoom(room, 'crate', { r, c: col, by: c.id });
  },
  hit(c, m) {
    const room = c.room; if (!room || !room.race || room.race.phase !== 'racing') return;
    const r = Number(m.r), col = Number(m.c), key = r + ',' + col;
    const cell = (room.race.level.cells[r] && room.race.level.cells[r][col]) || null;
    if (!cell || !cell.star || room.race.activated.has(key)) return;
    room.race.activated.add(key);
    broadcastRoom(room, 'star_block', { r, c: col, by: c.id });
  },
  take(c, m) {
    const room = c.room; if (!room || !room.race) return;
    const id = String(m.id || '').slice(0, 40);
    if (!id || room.race.taken.has(id)) return;
    room.race.taken.add(id);
    broadcastRoom(room, 'taken', { id, by: c.id }, c);
  },
  finish(c, m) {
    const room = c.room;
    if (!room || !room.race || room.race.phase !== 'racing' || c.finished) return;
    const r = room.race;
    const now = Date.now();
    if (now < r.startAt || c.x < r.finishX - Level.TILE) return; // ainda não chegou de verdade
    c.finished = true;
    c.coins = Math.max(0, Math.min(999, Number(m.coins) || 0));
    r.finished.push({ id: c.id, nick: c.nick, color: c.color, time: now - r.startAt, coins: c.coins });
    if (r.finished.length === 1) { // primeiro a chegar: os outros têm 15 s
      r.endsAt = now + FINISH_GRACE_MS;
      r.graceTimer = setTimeout(() => { if (room.race === r && r.phase === 'racing') endRace(room); }, FINISH_GRACE_MS);
    }
    broadcastRoom(room, 'player_finish', { id: c.id, nick: c.nick, place: r.finished.length, time: now - r.startAt, finished: r.finished.length, total: room.players.size, endsAt: r.endsAt });
    checkRaceEnd(room);
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
