// Lobby e corrida: salas via WebSocket (server/server.js), largada, chegada e placar.
// Sem conexão, funciona em modo offline (só "Jogar sozinho").

(() => {
  const $ = (id) => document.getElementById(id);
  const screens = { lobby: $('lobby'), hero: $('heroscreen'), gate: $('fsgate'), game: $('gamescreen') };
  // Celular/tablet: ponteiro "grosso" (toque). Notebooks com touchscreen continuam no modo desktop.
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const els = {
    nick: $('nick'), status: $('netstatus'), rooms: $('rooms'), roomsEmpty: $('rooms-empty'),
    createForm: $('create-form'), roomName: $('room-name'), passRow: $('pass-row'), roomPass: $('room-pass'),
    joinForm: $('join-form'), joinCode: $('join-code'), joinPass: $('join-pass'), joinMsg: $('join-msg'), createMsg: $('create-msg'),
    solo: $('solo'), hudRoom: $('hud-room'), hudCode: $('hud-code'), hudPlayers: $('hud-players'), leave: $('leave'),
    hudTime: $('hud-time'), hudCoins: $('hud-coins'), hudDeadline: $('hud-deadline'), touchDeadline: $('touch-deadline'), hudSpeed: $('hud-speed'), touchSpeed: $('touch-speed'), hudDash: $('hud-dash'), dashCharges: $('dash-charges'), dashBtn: $('dash'), hudFinished: $('hud-finished'), hudNote: $('hud-note'),
    touchTime: $('touch-time'), touchCoins: $('touch-coins'),
    results: $('results'), resultsList: $('results-list'), resultsNext: $('results-next'),
    canvas: $('game'), offlineNote: $('offline-note'), fsButton: $('fs-enter'),
  };

  let ws = null, online = false, myId = null;
  let currentRoom = null;          // { code, name, visibility } | null (sozinho)
  let myColor = Game.COLORS[Math.floor(Math.random() * Game.COLORS.length)];
  const players = new Map();       // id -> { id, nick, color, x, y, f, a } (outros jogadores da sala)
  let reconnectDelay = 1000, hbTimer = 0, lastRecv = 0;
  const SILENCE_MS = 10000; // sem nada do servidor por 10 s → a conexão morreu (o proxy pode deixá-la "aberta" à toa)
  let lastRooms = [];              // última lista recebida do servidor
  let race = null;                 // { seed, startAt, phase, results, nextAt, finished }
  let clockOffset = 0;             // relógio do servidor − local
  let clockSynced = false;         // já medimos por ping-pong? (senão usa o "now" das mensagens, sem compensar latência)
  let syncBestRtt = Infinity, syncTimer = null;
  // Mede o relógio do servidor descontando a ida e volta: 6 pings, fica com o de menor RTT; repete a cada 30 s.
  function syncClock() {
    syncBestRtt = Infinity;
    let n = 0;
    const tick = () => { if (ws && ws.readyState === 1) sendMsg('ping', { t0: Date.now() }); if (++n < 6) setTimeout(tick, 150); };
    tick();
  }
  function onPong(m) {
    const t1 = Date.now(), rtt = t1 - m.t0;
    if (rtt < 0 || rtt > 5000) return;
    if (rtt <= syncBestRtt) {
      syncBestRtt = rtt;
      clockOffset = m.server + rtt / 2 - t1;
      clockSynced = true;
      Engine.setClockOffset(clockOffset);
    }
  }
  let soloSeed = 0;
  let Engine = Game;               // motor da sala atual (Game = corrida, Arena = combate)
  function setEngine(e) { Engine = e; window.ActiveEngine = e; document.body.classList.toggle('mode-arena', e === Arena); const jb = $('jump'); if (jb) jb.textContent = e === Arena ? 'ATACAR' : 'PULAR'; for (const x of document.querySelectorAll('.hint-arena')) x.hidden = e !== Arena; }

  // ---------- personagem ----------
  let heroStr = '';
  // sem personagem salvo → sorteia um e guarda (vale para quem entra numa partida sem passar pelo editor)
  function ensureHero() {
    if (!Hero.ready()) return;
    let saved = null; try { saved = localStorage.getItem('hero'); } catch {}
    if (saved && Hero.decode(saved)) return;
    const cfg = Hero.random();
    try { localStorage.setItem('hero', Hero.encode(cfg)); } catch {}
  }
  function refreshHero() {
    ensureHero();
    heroStr = Hero.ready() ? Hero.encode(HeroEditor.current()) : '';
    const av = $('hero-avatar'); if (av && Hero.ready()) { const g = av.getContext('2d'); g.clearRect(0, 0, 48, 48); Hero.draw(g, HeroEditor.current(), 'i', 0, 24, 46, false, 3); }
  }
  window.addEventListener('hero-changed', () => { refreshHero(); sendMsg('hello', { nick: nick(), color: myColor, hero: heroStr }); });

  // ---------- util ----------
  const nick = () => (els.nick.value.trim() || 'Jogador').slice(0, 16);
  try { els.nick.value = localStorage.getItem('nick') || ''; } catch {}
  els.nick.addEventListener('change', () => {
    try { localStorage.setItem('nick', nick()); } catch {}
    sendMsg('hello', { nick: nick(), color: myColor, hero: heroStr });
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
    Music.start(); // gesto do usuário: libera o áudio no celular
    await enterFullscreen();
    if (currentScreen === 'gate') { show('game'); els.canvas.focus(); }
  });
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
  const fmtTime = (ms) => {
    if (ms == null) return '—';
    const s = ms / 1000;
    return s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}` : `${s.toFixed(2)} s`;
  };

  // ---------- lista de salas ----------
  let askingCode = null, askingError = '';
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
      const modeBadge = document.createElement('span');
      modeBadge.className = 'badge mode-badge';
      modeBadge.textContent = MODE_NAMES[r.mode] || 'Corrida louca';
      side.appendChild(modeBadge);
      if (r.visibility === 'private') {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = r.hasPassword ? 'privada · senha' : 'privada';
        side.appendChild(badge);
      }
      if (r.hasPassword && askingCode === r.code) {
        const form = document.createElement('form');
        form.className = 'room-pass';
        form.innerHTML = '<input type="password" maxlength="32" placeholder="Senha" autocomplete="off" aria-label="Senha da sala"><button type="submit" class="btn small">Entrar</button>';
        form.addEventListener('submit', (e) => { e.preventDefault(); askingError = ''; sendMsg('join', { code: r.code, password: form.querySelector('input').value }); });
        side.appendChild(form);
        if (askingError) { const err = document.createElement('span'); err.className = 'room-err'; err.textContent = askingError; li.appendChild(err); }
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

  // ---------- sala / corrida ----------
  function pushRemote() {
    Engine.setRemote([...players.values()].map((p) => ({ peer: p.id, x: p.x, y: p.y, f: p.f, a: p.a, color: p.color, nick: p.nick, hero: p.hero || '', hp: p.hp, alive: p.alive })));
    els.hudPlayers.textContent = String(players.size + 1);
  }

  // Começa a corrida recebida do servidor (ou uma local, sozinho)
  function beginRace(r) {
    race = r;
    if (!clockSynced) clockOffset = r.now - Date.now();
    hideResults();
    Engine.setFrozen(false);
    Game.startRace({
      seed: r.seed, startAt: r.startAt, serverNow: r.now, clockOffset: clockSynced ? clockOffset : undefined,
      color: myColor, nick: nick(), hero: heroStr,
      onState: currentRoom ? (s) => sendMsg('state', s) : null,
      onFinish: ({ coins, time }) => {
        if (currentRoom) sendMsg('finish', { coins });
        else showResults([{ id: 'me', nick: nick(), color: myColor, time: Math.round(time * 1000), coins }], null);
      },
      onCrate: currentRoom ? (r, c) => sendMsg('break', { r, c }) : null,
      onStarBlock: currentRoom ? (r, c) => sendMsg('starblock', { r, c }) : null,
      onTake: currentRoom ? (id) => sendMsg('take', { id }) : null,
    });
    Game.applyWorld({ broken: r.broken, activated: r.activated });
    pushRemote();
    els.hudFinished.textContent = `${r.finished || 0}/${players.size + 1}`;
    setNote('');
  }
  function setNote(text) { els.hudNote.textContent = text; }

  // rodada da arena (servidor): { seed, startAt, now, players:[{id,hp,alive}], spawn }
  function beginArena(a) {
    race = a;
    if (!clockSynced) clockOffset = a.now - Date.now();
    hideResults();
    Engine.setFrozen(false);
    for (const p of players.values()) { const st = (a.players || []).find((x) => x.id === p.id); if (st) { p.hp = st.hp; p.alive = st.alive; if (Number.isFinite(st.x)) { p.x = st.x; p.y = st.y; p.a = 'i'; } } }
    Arena.start({
      seed: a.seed, startAt: a.startAt, serverNow: a.now, clockOffset: clockSynced ? clockOffset : undefined,
      id: myId, hero: heroStr, nick: nick(), spawn: a.spawn,
      hp: (a.players || []).find((x) => x.id === myId)?.hp, alive: (a.players || []).find((x) => x.id === myId)?.alive,
      onState: (s) => sendMsg('state', s),
      onAttack: () => sendMsg('attack', {}),
      onHit: (id) => sendMsg('hit', { target: id }),
      onHazard: (kind) => sendMsg('hazard', { kind }),
    });
    pushRemote();
    setNote('Arena: ' + (Arena.stats().arena || ''));
  }

  function enterRoom(r, list, raceInfo, arenaInfo) {
    if (!heroStr) refreshHero(); // garante um personagem (aleatório se nunca escolheu) ao entrar na partida
    setEngine(arenaInfo ? Arena : Game);
    currentRoom = r;
    askingCode = null; askingError = '';
    players.clear();
    for (const p of list || []) players.set(p.id, { ...p, x: Number(p.x) || 0, y: Number(p.y) || 0 });
    els.hudRoom.textContent = r ? r.name : 'Jogando sozinho';
    els.hudCode.textContent = r && r.visibility === 'private' ? `código ${r.code}` : '';
    els.hudPlayers.textContent = String(players.size + 1);
    if (isTouch && !fsElement()) show('gate');
    else { show('game'); els.canvas.focus(); }
    Music.start();
    if (arenaInfo) {
      beginArena(arenaInfo);
      if (arenaInfo.phase === 'results') showResults(arenaInfo.results || [], arenaInfo.nextAt);
    } else if (raceInfo) {
      beginRace(raceInfo);
      if (raceInfo.phase === 'results') showResults(raceInfo.results || [], raceInfo.nextAt);
    } else {
      // sozinho: corrida local com semente aleatória (ou a da URL, para testes)
      if (!soloSeed) soloSeed = Math.floor(Math.random() * 2 ** 31);
      beginRace({ seed: soloSeed, startAt: Date.now() + 4000, now: Date.now(), phase: 'racing', finished: 0 });
    }
  }

  function leaveRoom() {
    Engine.stop();
    if (currentRoom) sendMsg('leave', {});
    currentRoom = null; race = null;
    players.clear();
    hideResults();
    Music.stop();
    exitFullscreen();
    show('lobby');
  }

  // ---------- placar ----------
  let resultsTimer = null, soloNextTimer = null;
  function showResults(list, nextAt) {
    Engine.setFrozen(true);
    els.resultsList.innerHTML = '';
    list.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'result' + (p.id === myId || p.id === 'me' ? ' me' : '');
      li.innerHTML = `<span class="place"></span><span class="who"><i class="avatar"></i><span class="name"></span></span><span class="time"></span><span class="coins"></span>`;
      li.querySelector('.place').textContent = p.time == null ? '—' : `${i + 1}º`;
      li.querySelector('.avatar').dataset.color = p.color || 'green';
      li.querySelector('.name').textContent = p.nick || 'Jogador';
      li.querySelector('.time').textContent = p.label != null ? p.label : (p.time == null ? 'não terminou' : fmtTime(p.time));
      if (p.label != null) li.querySelector('.time').classList.add('label');
      li.querySelector('.coins').textContent = p.label != null ? '' : `${p.coins || 0} 🪙`;
      if (p.label != null) li.querySelector('.place').textContent = `${i + 1}º`;
      els.resultsList.appendChild(li);
    });
    els.results.hidden = false;
    clearInterval(resultsTimer);
    // jingle: venceu → Victory; chegou sem vencer → Complete; não terminou (ou entrou agora) → nada
    const me = list.find((p) => p.id === myId || p.id === 'me');
    if (me && me.label != null) Music.playJingle(me.label === 'Venceu!' ? 'victory' : 'complete');
    else if (me && me.time != null) Music.playJingle(list[0] === me ? 'victory' : 'complete');
    if (!currentRoom) { // sozinho: nova fase depois de 5 s
      nextAt = Date.now() + 5000;
      clearTimeout(soloNextTimer);
      soloNextTimer = setTimeout(() => {
        if (!currentRoom && currentScreen !== 'lobby') { soloSeed = Math.floor(Math.random() * 2 ** 31); beginRace({ seed: soloSeed, startAt: Date.now() + 4000, now: Date.now(), phase: 'racing', finished: 0 }); }
      }, 5000);
    }
    const tick = () => {
      if (nextAt == null) { els.resultsNext.textContent = ''; return; }
      const s = Math.max(0, Math.ceil((nextAt - (Date.now() + clockOffset)) / 1000));
      const what = Engine === Arena ? 'batalha' : 'corrida';
      els.resultsNext.textContent = s > 0 ? `Próxima ${what} em ${s} s` : 'Começando…';
    };
    tick();
    resultsTimer = setInterval(tick, 250);
  }
  function hideResults() { els.results.hidden = true; clearInterval(resultsTimer); }

  // ---------- HUD ----------
  let lastDashKey = '';
  setInterval(() => {
    if (currentScreen !== 'game' && currentScreen !== 'gate') return;
    const s = Engine.stats();
    const t = s.time < 0 ? '0.0 s' : s.time >= 60 ? `${Math.floor(s.time / 60)}:${(s.time % 60).toFixed(1).padStart(4, '0')}` : `${s.time.toFixed(1)} s`;
    els.hudTime.textContent = t; els.touchTime.textContent = t;
    els.hudCoins.textContent = String(s.coins); els.touchCoins.textContent = String(s.coins);
    const sp = `+${Math.round(s.boost * 100)}%`; els.hudSpeed.textContent = sp; els.touchSpeed.textContent = sp;
    let dl = '';
    if (race && race.endsAt && race.phase === 'racing' && !s.finished) { const left = Math.max(0, (race.endsAt - (Date.now() + clockOffset)) / 1000); dl = `⏳ ${left.toFixed(0)} s`; }
    els.hudDeadline.textContent = dl; els.touchDeadline.textContent = dl;
    if (lastDashKey !== s.dashes + '/' + s.dashMax) {
      lastDashKey = s.dashes + '/' + s.dashMax;
      const ticks = Array.from({ length: Math.max(s.dashMax, s.dashes) }, (_, i) => `<i class="${i < s.dashes ? (i >= s.dashMax ? 'extra' : '') : 'off'}"></i>`).join('');
      els.hudDash.innerHTML = ticks; els.dashCharges.innerHTML = ticks;
      els.dashBtn.disabled = s.dashes <= 0;
    }
  }, 100);

  // ---------- mensagens do servidor ----------
  const on = {
    welcome(m) { myId = m.id; if (m.color) myColor = m.color; },
    rooms(m) { lastRooms = m.rooms || []; if (!currentRoom) renderRooms(lastRooms); },
    joined(m) {
      setMsg(els.createMsg, ''); setMsg(els.joinMsg, '');
      els.roomName.value = ''; els.roomPass.value = ''; els.joinCode.value = ''; els.joinPass.value = '';
      enterRoom({ code: m.code, name: m.name, visibility: m.visibility, mode: m.mode }, m.players, m.race, m.arena);
    },
    player_join(m) { if (currentRoom) { players.set(m.player.id, { ...m.player, x: Number(m.player.x) || 0, y: Number(m.player.y) || 0 }); pushRemote(); } },
    player_leave(m) { if (players.delete(m.id)) pushRemote(); },
    player_update(m) { const p = players.get(m.id); if (p) { p.nick = m.nick; p.color = m.color; p.hero = m.hero || ''; pushRemote(); } },
    state(m) { const p = players.get(m.id); if (!p) return; p.x = m.x; p.y = m.y; p.f = m.f; p.a = m.a; pushRemote(); },
    player_finish(m) {
      if (race && m.endsAt) race.endsAt = m.endsAt;
      els.hudFinished.textContent = `${m.finished}/${m.total}`;
      setNote(m.id === myId ? `Você chegou em ${m.place}º (${fmtTime(m.time)})` : `${m.nick} chegou em ${m.place}º`);
    },
    race_start(m) { if (currentRoom) beginRace(m); },
    arena_start(m) { if (currentRoom) { for (const p of players.values()) { p.hp = Arena.MAX_HP; p.alive = true; } beginArena(m); } },
    arena_end(m) { if (currentRoom) { race = m; if (!clockSynced) clockOffset = m.now - Date.now(); showResults(m.results || [], m.nextAt); } },
    player_attack(m) { Arena.remoteAttack(m.id); },
    damage(m) { const p = players.get(m.id); if (p) { p.hp = m.hp; if (m.hp <= 0) p.alive = false; } Arena.applyDamage(m); },
    eliminated(m) { const p = players.get(m.id); if (p) p.alive = false; setNote(m.id === myId ? 'Você foi eliminado' : `${(p && p.nick) || 'Alguém'} foi eliminado · ${m.alive} vivo(s)`); },
    crate(m) { Game.breakCrate(m.r, m.c, { sound: m.by !== myId }); },
    star_block(m) { Game.activateStar(m.r, m.c, { sound: m.by !== myId }); },
    taken(m) { if (m.by !== myId) Game.removeItem(m.id); },
    race_end(m) { if (currentRoom) { race = m; if (!clockSynced) clockOffset = m.now - Date.now(); showResults(m.results || [], m.nextAt); } },
    pong(m) { onPong(m); },
    hb() {},
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
      reconnectDelay = 1000; setOnline(true); setStatus('Online', 'ok'); sendMsg('hello', { nick: nick(), color: myColor, hero: heroStr });
      clockSynced = false; syncClock(); clearInterval(syncTimer); syncTimer = setInterval(syncClock, 30000);
      lastRecv = Date.now(); clearInterval(hbTimer);
      hbTimer = setInterval(() => { // batimento: o servidor derruba quem fica 12 s em silêncio; e nós derrubamos se ele some
        if (Date.now() - lastRecv > SILENCE_MS) { dropConnection(); return; }
        sendMsg('hb', {});
      }, 4000);
    };
    ws.onmessage = (ev) => { lastRecv = Date.now(); let m; try { m = JSON.parse(ev.data); } catch { return; } const h = on[m && m.type]; if (h) h(m); };
    ws.onclose = onClosed;
    ws.onerror = () => {};
  }
  function onClosed() {
    setOnline(false); clearInterval(hbTimer);
    if (currentRoom) leaveRoom();   // a sala morreu com a conexão
    setStatus('Offline — tentando reconectar…', 'warn');
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(15000, reconnectDelay * 2);
  }
  // conexão silenciosa: descarta o socket sem esperar o handshake de fechamento (que pode nunca vir) e reconecta
  function dropConnection() {
    const old = ws; ws = null;
    if (old) { old.onclose = null; old.onmessage = null; try { old.close(); } catch {} }
    onClosed();
  }

  // ---------- formulários ----------
  els.createForm.addEventListener('change', () => {
    const priv = els.createForm.visibility.value === 'private';
    els.passRow.hidden = !priv;
    if (!priv) els.roomPass.value = '';
  });
  // criar sala: primeiro escolhe o modo de jogo num modal
  const MODE_NAMES = { race: 'Corrida louca', arena: 'Arena' };
  const modeModal = $('mode-modal');
  els.createForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!online) return;
    modeModal.hidden = false;
    const first = modeModal.querySelector('.mode'); if (first) first.focus();
  });
  $('mode-cancel').addEventListener('click', () => { modeModal.hidden = true; });
  modeModal.addEventListener('click', (e) => { if (e.target === modeModal) modeModal.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modeModal.hidden) modeModal.hidden = true; });
  for (const b of modeModal.querySelectorAll('.mode')) b.addEventListener('click', () => {
    modeModal.hidden = true;
    setMsg(els.createMsg, 'Criando…');
    sendMsg('create', { name: els.roomName.value.trim(), visibility: els.createForm.visibility.value, password: els.roomPass.value, mode: b.dataset.mode });
  });
  els.joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!online) return;
    const code = els.joinCode.value.trim().toUpperCase();
    if (code.length !== 6) return setMsg(els.joinMsg, 'O código tem 6 caracteres.', 'error');
    setMsg(els.joinMsg, 'Procurando…');
    sendMsg('join', { code, password: els.joinPass.value });
  });
  els.solo.addEventListener('click', () => { setEngine(Game); enterRoom(null); });
  $('btn-hero').addEventListener('click', () => { show('hero'); HeroEditor.show(); });
  HeroEditor.init({ onClose: () => show('lobby') });
  els.leave.addEventListener('click', leaveRoom);
  $('gate-leave').addEventListener('click', leaveRoom);

  // ---------- boot ----------
  (async () => {
    document.body.classList.toggle('touch', isTouch);
    show('lobby');
    els.passRow.hidden = true;
    setOnline(false);
    await Game.load(els.canvas);
    try { await Arena.load(els.canvas); } catch (e) { console.warn('arena indisponível', e); }
    try { await Hero.load(); } catch (e) { console.warn('heróis indisponíveis', e); }
    refreshHero();
    // avatar do lobby atualiza quando as peças terminam de carregar
    setTimeout(refreshHero, 1500);
    connect();
    // ?solo=1&seed=N: entra direto jogando sozinho (útil para testes)
    const q = new URLSearchParams(location.search);
    if (q.get('hero')) { show('hero'); HeroEditor.show(); } // ?hero=1 abre o editor direto (testes)
    if (q.get('arena')) { setEngine(Arena); show('game'); Arena.start({ seed: +(q.get('seed') || 0), startAt: Date.now() + 1000, serverNow: Date.now(), id: 'me', hero: heroStr, nick: nick() }); if (q.get('overview')) Arena.setOverview(true); }
    if (q.get('solo')) { if (q.get('seed')) soloSeed = +q.get('seed'); enterRoom(null); if (q.get('x')) Game.__test.player.x = +q.get('x'); }
  })().catch((err) => { setStatus('Erro: ' + err.message, 'error'); console.error(err); });
})();
