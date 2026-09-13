// Lobby: salas e posições dos jogadores via WebSocket (server/server.js).
// Sem conexão, funciona em modo offline (só "Jogar sozinho").

(() => {
  const $ = (id) => document.getElementById(id);
  const screens = { lobby: $('lobby'), gate: $('fsgate'), game: $('gamescreen') };
  // Celular/tablet: ponteiro "grosso" (toque). Notebooks com touchscreen continuam no modo desktop.
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const els = {
    nick: $('nick'), status: $('netstatus'), rooms: $('rooms'), roomsEmpty: $('rooms-empty'),
    createForm: $('create-form'), roomName: $('room-name'), passRow: $('pass-row'), roomPass: $('room-pass'),
    joinForm: $('join-form'), joinCode: $('join-code'), joinPass: $('join-pass'), joinMsg: $('join-msg'), createMsg: $('create-msg'),
    solo: $('solo'), hudRoom: $('hud-room'), hudCode: $('hud-code'), hudPlayers: $('hud-players'), leave: $('leave'),
    canvas: $('game'), offlineNote: $('offline-note'), fsButton: $('fs-enter'),
  };

  let ws = null, online = false, myId = null;
  let currentRoom = null;          // { code, name, visibility } | null (sozinho)
  let myColor = Game.COLORS[Math.floor(Math.random() * Game.COLORS.length)];
  const players = new Map();       // id -> { id, nick, color, x, y, f, a } (outros jogadores da sala)
  let reconnectDelay = 1000;
  let lastRooms = [];              // última lista recebida do servidor

  // ---------- util ----------
  const nick = () => (els.nick.value.trim() || 'Jogador').slice(0, 16);
  try { els.nick.value = localStorage.getItem('nick') || ''; } catch {}
  els.nick.addEventListener('change', () => {
    try { localStorage.setItem('nick', nick()); } catch {}
    sendMsg('hello', { nick: nick(), color: myColor });
  });

  let currentScreen = 'lobby';
  function show(name) {
    currentScreen = name;
    for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
    document.body.classList.toggle('in-game', name === 'game');
  }

  // ---------- tela cheia (celular) ----------
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  async function enterFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return false; // iPhone: sem API de tela cheia; mostra o jogo mesmo assim
    try { await req.call(el, { navigationUI: 'hide' }); } catch { return false; }
    try { await screen.orientation.lock('landscape'); } catch {}
    return true;
  }
  function exitFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (fsElement() && exit) exit.call(document).catch(() => {});
  }
  els.fsButton.addEventListener('click', async () => {
    await enterFullscreen();
    if (currentScreen === 'gate') { show('game'); els.canvas.focus(); }
  });
  // Saiu da tela cheia (gesto do sistema) → volta para o portão, sem sair da sala
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
    document.addEventListener(ev, () => { if (isTouch && currentScreen === 'game' && !fsElement()) show('gate'); });
  }
  function setMsg(el, text, kind) { el.textContent = text || ''; el.dataset.kind = kind || ''; }
  function setStatus(text, kind) { els.status.textContent = text; els.status.dataset.kind = kind; }
  function setOnline(v) {
    online = v;
    els.offlineNote.hidden = v;
    els.createForm.querySelector('button[type=submit]').disabled = !v;
    els.joinForm.querySelector('button[type=submit]').disabled = !v;
  }
  function sendMsg(type, data) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, ...data }));
  }

  // ---------- lista de salas ----------
  let askingCode = null;   // sala cujo campo de senha está aberto na lista
  let askingError = '';
  function renderRooms(list) {
    const now = Date.now();
    els.rooms.innerHTML = '';
    els.roomsEmpty.hidden = list.length > 0;
    if (askingCode && !list.some((r) => r.code === askingCode)) { askingCode = null; askingError = ''; }
    for (const r of list) {
      const li = document.createElement('li');
      li.className = 'room';
      li.innerHTML = `
        <div class="room-main">
          <span class="room-name"></span>
          <span class="room-meta"><span class="count"></span> · criada por <span class="by"></span> · ${fmtAge(Math.max(0, now - r.createdAt))}</span>
        </div>
        <div class="room-side"></div>`;
      li.querySelector('.room-name').textContent = r.name;
      li.querySelector('.by').textContent = r.createdBy || 'alguém';
      li.querySelector('.count').textContent = r.count === 1 ? '1 jogador' : `${r.count} jogadores`;
      const side = li.querySelector('.room-side');
      if (r.visibility === 'private') {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = r.hasPassword ? 'privada · senha' : 'privada';
        side.appendChild(badge);
      }
      if (r.hasPassword && askingCode === r.code) {
        // pede a senha na própria linha
        const form = document.createElement('form');
        form.className = 'room-pass';
        form.innerHTML = '<input type="password" maxlength="32" placeholder="Senha" autocomplete="off" aria-label="Senha da sala"><button type="submit" class="btn small">Entrar</button>';
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          askingError = '';
          sendMsg('join', { code: r.code, password: form.querySelector('input').value });
        });
        side.appendChild(form);
        if (askingError) {
          const err = document.createElement('span');
          err.className = 'room-err';
          err.textContent = askingError;
          li.appendChild(err);
        }
        requestAnimationFrame(() => form.querySelector('input').focus());
      } else {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'btn small'; btn.textContent = 'Entrar';
        btn.addEventListener('click', () => {
          if (r.hasPassword) { askingCode = r.code; askingError = ''; renderRooms(lastRooms); }
          else sendMsg('join', { code: r.code });
        });
        side.appendChild(btn);
      }
      els.rooms.appendChild(li);
    }
  }
  function fmtAge(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'agora';
    if (m < 60) return `há ${m} min`;
    const h = Math.floor(m / 60);
    return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
  }

  // ---------- sala ----------
  function pushRemote() {
    Game.setRemote([...players.values()].map((p) => ({ peer: p.id, x: p.x, y: p.y, f: p.f, a: p.a, color: p.color, nick: p.nick })));
    els.hudPlayers.textContent = String(players.size + 1);
  }

  function enterRoom(r, spawnX, list) {
    currentRoom = r;
    askingCode = null; askingError = '';
    players.clear();
    for (const p of list || []) players.set(p.id, { ...p, x: Number(p.x) || 0, y: Number(p.y) || Game.GROUND_Y });
    els.hudRoom.textContent = r ? r.name : 'Jogando sozinho';
    els.hudCode.textContent = r && r.visibility === 'private' ? `código ${r.code}` : '';
    els.hudPlayers.textContent = r ? String(players.size + 1) : '—';
    // No celular o jogo só aparece depois de entrar em tela cheia; a partida já começa (posição é enviada)
    if (isTouch && !fsElement()) show('gate');
    else { show('game'); els.canvas.focus(); }
    Game.start({
      color: myColor,
      nick: nick(),
      spawnX: Number.isFinite(spawnX) ? spawnX : undefined,
      onState: r ? (s) => sendMsg('state', s) : null,
    });
    pushRemote();
  }

  function leaveRoom() {
    Game.stop();
    if (currentRoom) sendMsg('leave', {});
    currentRoom = null;
    players.clear();
    exitFullscreen();
    show('lobby');
  }

  // ---------- mensagens do servidor ----------
  const on = {
    welcome(m) { myId = m.id; if (m.color) myColor = m.color; },
    rooms(m) { lastRooms = m.rooms || []; if (!currentRoom) renderRooms(lastRooms); },
    joined(m) {
      setMsg(els.createMsg, ''); setMsg(els.joinMsg, '');
      els.roomName.value = ''; els.roomPass.value = ''; els.joinCode.value = ''; els.joinPass.value = '';
      enterRoom({ code: m.code, name: m.name, visibility: m.visibility }, m.spawnX, m.players);
    },
    player_join(m) { if (currentRoom) { players.set(m.player.id, { ...m.player, x: Number(m.player.x) || 0, y: Number(m.player.y) || Game.GROUND_Y }); pushRemote(); } },
    player_leave(m) { if (players.delete(m.id)) pushRemote(); },
    state(m) {
      const p = players.get(m.id);
      if (!p) return;
      p.x = m.x; p.y = m.y; p.f = m.f; p.a = m.a;
      pushRemote();
    },
    error(m) {
      if (m.ctx === 'join' && askingCode) { askingError = m.msg || 'Erro'; renderRooms(lastRooms); return; }
      setMsg(m.ctx === 'join' ? els.joinMsg : els.createMsg, m.msg || 'Erro', 'error');
    },
  };

  // ---------- conexão ----------
  function connect() {
    const url = window.SERVER_URL;
    if (!url) { setStatus('Offline — sem servidor configurado', 'warn'); return; }
    setStatus('Conectando…', 'warn');
    ws = new WebSocket(url);
    ws.onopen = () => {
      reconnectDelay = 1000;
      setOnline(true);
      setStatus('Online', 'ok');
      sendMsg('hello', { nick: nick(), color: myColor });
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const h = on[m && m.type];
      if (h) h(m);
    };
    ws.onclose = () => {
      setOnline(false);
      if (currentRoom) leaveRoom();   // a sala morreu com a conexão
      setStatus('Offline — tentando reconectar…', 'warn');
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(15000, reconnectDelay * 2);
    };
    ws.onerror = () => {};
  }

  // ---------- formulários ----------
  els.createForm.addEventListener('change', () => {
    const priv = els.createForm.visibility.value === 'private';
    els.passRow.hidden = !priv;
    if (!priv) els.roomPass.value = '';
  });
  els.createForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!online) return;
    const name = els.roomName.value.trim();
    if (!name) return setMsg(els.createMsg, 'Dê um nome para a sala.', 'error');
    setMsg(els.createMsg, 'Criando…');
    sendMsg('create', { name, visibility: els.createForm.visibility.value, password: els.roomPass.value });
  });
  els.joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!online) return;
    const code = els.joinCode.value.trim().toUpperCase();
    if (code.length !== 6) return setMsg(els.joinMsg, 'O código tem 6 caracteres.', 'error');
    setMsg(els.joinMsg, 'Procurando…');
    sendMsg('join', { code, password: els.joinPass.value });
  });
  els.solo.addEventListener('click', () => enterRoom(null));
  els.leave.addEventListener('click', leaveRoom);

  // ---------- boot ----------
  (async () => {
    document.body.classList.toggle('touch', isTouch);
    show('lobby');
    els.passRow.hidden = true;
    setOnline(false);
    await Game.load(els.canvas);
    connect();
  })().catch((err) => { setStatus('Erro: ' + err.message, 'error'); console.error(err); });
})();
