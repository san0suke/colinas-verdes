// Motor do jogo: fase procedural (level.js), física com a grade de tiles, inimigos,
// moedas, molas, corrida com contagem regressiva e jogadores remotos.
// Assets: Kenney "New Platformer Pack" (CC0) — spritesheets em assets/sheets.

const Game = (() => {
  const COLORS = ['green', 'beige', 'pink', 'purple', 'yellow'];
  const TILE = 64;
  const W = 960, H = 576;

  // ---------- física ----------
  const GRAVITY = 2200, MAX_FALL = 1400;
  const MOVE_SPEED = 340, JUMP_SPEED = 820, JUMP_CUT = 0.45, COYOTE_TIME = 0.08, JUMP_BUFFER = 0.10;
  const HW = 24, BH = 96;                 // meia-largura e altura da caixa do jogador (pés em y)
  const BOUNCE_SPEED = 1500;              // quique em cima de outro jogador
  const ENEMY_BOUNCE = 780, SPRING_SPEED = 1350;
  const STOMP_TOLERANCE = 14, CAMERA_TOP_MARGIN = 120;
  const HURT_INVULN = 1.6, HIT_ANIM = 0.45;

  // ---------- atlas / áudio ----------
  const SHEETS = ['tiles', 'enemies', 'characters', 'backgrounds'];
  const atlas = new Map();                // nome → { img, x, y, w, h }
  const SOUNDS = { jump: 'sfx_jump', coin: 'sfx_coin', gem: 'sfx_gem', hurt: 'sfx_hurt', bump: 'sfx_bump', spring: 'sfx_jump-high', finish: 'sfx_magic', pop: 'sfx_disappear', tick: 'sfx_select' };
  const sounds = {};
  let muted = false;
  function play(name) {
    if (muted || !sounds[name]) return;
    try { const a = sounds[name].cloneNode(); a.volume = 0.5; a.play().catch(() => {}); } catch {}
  }

  function loadImage(src) {
    return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('Falha ao carregar ' + src)); img.src = src; });
  }
  async function loadSheet(name) {
    const base = `assets/sheets/spritesheet-${name}-default`;
    const [img, xml] = await Promise.all([loadImage(base + '.png'), fetch(base + '.xml').then((r) => r.text())]);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    for (const el of doc.querySelectorAll('SubTexture')) {
      atlas.set(el.getAttribute('name'), { img, x: +el.getAttribute('x'), y: +el.getAttribute('y'), w: +el.getAttribute('width'), h: +el.getAttribute('height') });
    }
  }
  function draw(name, dx, dy, flip) {
    const s = atlas.get(name);
    if (!s) return;
    if (flip) { ctx.save(); ctx.translate(dx + s.w, dy); ctx.scale(-1, 1); ctx.drawImage(s.img, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h); ctx.restore(); }
    else ctx.drawImage(s.img, s.x, s.y, s.w, s.h, dx, dy, s.w, s.h);
  }

  // ---------- fundo (dois tiles empilhados, como nos exemplos do Kenney) ----------
  const SKY_COLOR = 'rgb(195,227,255)';
  const BG_SCALE = 1.5;
  let bgLayers = [];
  function makeStrip(name) {
    const s = atlas.get(name);
    const c = document.createElement('canvas');
    c.width = Math.round(s.w * BG_SCALE); c.height = Math.round(s.h * BG_SCALE);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.drawImage(s.img, s.x, s.y, s.w, s.h, 0, 0, c.width, c.height);
    return { pattern: ctx.createPattern(c, 'repeat-x'), width: c.width, height: c.height };
  }
  function buildBackground(bg) {
    bgLayers = [
      { ...makeStrip('background_fade_' + bg), factor: 0.30, top: H - 417 }, // crista dos morros ≈ 36 px acima do chão
      { ...makeStrip('background_clouds'), factor: 0.10, top: H - 630 },
    ];
  }

  // ---------- estado ----------
  let canvas, ctx, loaded = null;
  let level = null;
  const collected = new Set();            // "r,c" das moedas pegas
  const dead = new Set();                 // índices dos inimigos derrotados
  let springs = new Map();                // "r,c" → instante em que a mola foi ativada
  const player = { x: 0, y: 0, vx: 0, vy: 0, facing: 1, onGround: false, coyote: 0, jumpBuffer: 0, bouncing: false, animTime: 0, color: 'green', nick: '', coins: 0, invuln: 0, hitUntil: 0, finished: false };
  const camera = { x: 0, y: 0 };
  const remote = new Map();
  let running = false, raf = 0, last = 0, frozen = false;
  let startAt = 0, clockOffset = 0;       // startAt em relógio do servidor; clockOffset = servidor − local
  let hooks = {};
  let lastSent = '';
  let now = 0;                            // tempo da corrida (s), pode ser negativo na contagem

  const serverNow = () => Date.now() + clockOffset;
  const raceTime = () => (serverNow() - startAt) / 1000;

  // ---------- input ----------
  const keys = new Set();
  let jumpPressedThisFrame = false;
  const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'];
  function onKeyDown(e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (JUMP_KEYS.includes(e.code) || e.code.startsWith('Arrow')) e.preventDefault();
    if (JUMP_KEYS.includes(e.code) && !keys.has(e.code)) jumpPressedThisFrame = true;
    keys.add(e.code);
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onBlur() { keys.clear(); }
  const virt = { left: false, right: false, jump: false };
  function setVirtualInput(patch) { if (patch.jump && !virt.jump) jumpPressedThisFrame = true; Object.assign(virt, patch); }
  const jumpHeld = () => virt.jump || JUMP_KEYS.some((k) => keys.has(k));
  const leftHeld = () => virt.left || keys.has('ArrowLeft') || keys.has('KeyA');
  const rightHeld = () => virt.right || keys.has('ArrowRight') || keys.has('KeyD');

  // ---------- grade ----------
  const cellAt = (r, c) => (level.cells[r] && level.cells[r][c]) || null;
  const isCollected = (r, c) => collected.has(r + ',' + c);
  function groundTopAt(col) { // y do topo do primeiro sólido da coluna (para renascer)
    for (let r = 0; r < level.rows; r++) { const x = cellAt(r, col); if (x && (x.k === 'solid' || x.k === 'oneway')) return r * TILE; }
    return Level.GROUND * TILE;
  }
  function respawn() {
    let cx = level.spawnX;
    for (const c of level.checkpoints) if (c <= player.x && c > cx) cx = c;
    player.x = cx; player.y = groundTopAt(Math.floor(cx / TILE));
    player.vx = 0; player.vy = 0; player.bouncing = false;
  }
  function hurt(reason) {
    if (player.invuln > 0) return;
    player.lastHurt = reason || '';
    play('hurt');
    player.invuln = HURT_INVULN; player.hitUntil = HIT_ANIM;
    respawn();
  }

  // ---------- inimigos (movimento determinístico em função do tempo) ----------
  const tri = (t) => { const p = ((t % 2) + 2) % 2; return p < 1 ? p : 2 - p; };
  function enemyPose(e, t) {
    if (e.kind === 'walker' || e.kind === 'flyer') {
      const span = e.x1 - e.x0;
      const u = (t * e.speed) / span + e.phase;
      const dir = ((u % 2) + 2) % 2 < 1 ? 1 : -1;
      const x = e.x0 + tri(u) * span;
      if (e.kind === 'walker') return { x, y: e.y, dir };
      return { x, y: e.y + 32 + Math.sin(t * 2.2 + e.phase) * e.amp, dir };
    }
    if (e.kind === 'fish') {
      const up = Math.max(0, Math.sin(t * e.speed + e.phase));
      return { x: e.x, y: e.y + 40 - up * 190, dir: 1, jumping: up > 0.05 };
    }
    return { x: e.x0, y: e.y, dir: 1 };
  }
  function enemySprite(e, t) {
    const f = Math.floor(t * 6) % 2 ? 'a' : 'b';
    switch (e.type) {
      case 'saw': return `saw_${f}`;
      case 'bee': case 'fly': return `${e.type}_${f}`;
      case 'fish_blue': case 'fish_yellow': return `${e.type}_swim_${f}`;
      case 'frog': return Math.floor(t * 2) % 2 ? 'frog_idle' : 'frog_jump';
      case 'ladybug': case 'mouse': case 'snail': return `${e.type}_walk_${f}`;
      case 'worm_normal': case 'worm_ring': return `${e.type}_move_${f}`;
      default: return `${e.type}_walk_${f}`; // slimes
    }
  }

  // ---------- update ----------
  function update(dt) {
    now = raceTime();
    const active = now >= 0 && !frozen;
    const dir = active ? (rightHeld() ? 1 : 0) - (leftHeld() ? 1 : 0) : 0;
    player.vx = dir * MOVE_SPEED;
    if (dir !== 0) player.facing = dir;
    if (!active) { jumpPressedThisFrame = false; player.jumpBuffer = 0; }

    player.coyote = player.onGround ? COYOTE_TIME : Math.max(0, player.coyote - dt);
    if (jumpPressedThisFrame) player.jumpBuffer = JUMP_BUFFER; else player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);
    jumpPressedThisFrame = false;
    if (player.bouncing) { player.jumpBuffer = 0; player.coyote = 0; }
    if (player.jumpBuffer > 0 && player.coyote > 0) { player.vy = -JUMP_SPEED; player.onGround = false; player.coyote = 0; player.jumpBuffer = 0; play('jump'); }
    if (!jumpHeld() && player.vy < 0 && !player.bouncing) player.vy *= Math.pow(JUMP_CUT, dt * 60);

    player.vy = Math.min(MAX_FALL, player.vy + GRAVITY * dt);
    player.invuln = Math.max(0, player.invuln - dt);
    player.hitUntil = Math.max(0, player.hitUntil - dt);
    const prevY = player.y;

    // --- horizontal ---
    player.x += player.vx * dt;
    player.x = Math.max(HW, Math.min(level.width - HW, player.x));
    {
      const r0 = Math.max(0, Math.floor((player.y - BH + 2) / TILE)), r1 = Math.min(level.rows - 1, Math.floor((player.y - 2) / TILE));
      const c0 = Math.floor((player.x - HW) / TILE), c1 = Math.floor((player.x + HW) / TILE);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const cell = cellAt(r, c);
        if (!cell || cell.k !== 'solid') continue;
        if (player.vx > 0) player.x = c * TILE - HW; else if (player.vx < 0) player.x = (c + 1) * TILE + HW;
      }
    }
    // --- vertical ---
    player.y += player.vy * dt;
    player.onGround = false;
    if (player.vy >= 0) {
      const c0 = Math.floor((player.x - HW + 4) / TILE), c1 = Math.floor((player.x + HW - 4) / TILE);
      const r0 = Math.max(0, Math.floor((prevY - 1) / TILE)), r1 = Math.min(level.rows - 1, Math.floor(player.y / TILE));
      for (let r = r0; r <= r1 && !player.onGround; r++) for (let c = c0; c <= c1; c++) {
        const cell = cellAt(r, c);
        if (!cell) continue;
        const top = r * TILE;
        if (cell.k === 'solid' || ((cell.k === 'oneway' || cell.k === 'spring') && prevY <= top + 6)) {
          if (player.y >= top) {
            player.y = top; player.vy = 0; player.onGround = true; player.bouncing = false;
            if (cell.k === 'spring') { player.vy = -SPRING_SPEED; player.onGround = false; player.bouncing = true; springs.set(r + ',' + c, now); play('spring'); }
            break;
          }
        }
      }
    } else {
      const c0 = Math.floor((player.x - HW + 4) / TILE), c1 = Math.floor((player.x + HW - 4) / TILE);
      const r = Math.floor((player.y - BH) / TILE);
      for (let c = c0; c <= c1; c++) {
        const cell = cellAt(r, c);
        if (cell && cell.k === 'solid') { player.y = (r + 1) * TILE + BH; player.vy = 0; play('bump'); break; }
      }
    }

    // --- moedas, perigos ---
    {
      const c0 = Math.floor((player.x - HW + 6) / TILE), c1 = Math.floor((player.x + HW - 6) / TILE);
      const r0 = Math.max(0, Math.floor((player.y - BH + 8) / TILE)), r1 = Math.min(level.rows - 1, Math.floor((player.y - 8) / TILE));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const cell = cellAt(r, c);
        if (!cell) continue;
        if (cell.k === 'coin' && !isCollected(r, c)) { collected.add(r + ',' + c); player.coins++; play(cell.s.startsWith('gem') ? 'gem' : 'coin'); }
        else if (cell.k === 'hazard') hurt('hazard ' + cell.s + ' r' + r + ' c' + c);
      }
    }
    // --- inimigos ---
    const t = Math.max(0, now);
    level.entities.forEach((e, i) => {
      if (dead.has(i)) return;
      const p = enemyPose(e, t);
      if (e.kind === 'fish' && !p.jumping) return;
      const ex0 = p.x - 22, ex1 = p.x + 22, ey0 = p.y - 46, ey1 = p.y - 4;
      if (player.x + HW - 6 < ex0 || player.x - HW + 6 > ex1 || player.y - 6 < ey0 || player.y - BH + 6 > ey1) return;
      const stomp = player.vy > 0 && prevY <= ey0 + STOMP_TOLERANCE + 10;
      if (stomp && !level.hurtOnStomp.some((k) => e.type.startsWith(k))) {
        dead.add(i); player.vy = -ENEMY_BOUNCE; player.y = ey0; player.bouncing = true; play('pop');
      } else hurt('enemy ' + e.type);
    });
    // --- quique em cima de outro jogador ---
    if (player.vy > 0) {
      for (const r of remote.values()) {
        const headY = r.y - BH;
        if (Math.abs(player.x - r.x) < 2 * HW + 4 && prevY <= headY + STOMP_TOLERANCE && player.y >= headY) {
          player.y = headY; player.vy = -BOUNCE_SPEED; player.bouncing = true; player.coyote = 0; play('bump'); break;
        }
      }
    }
    if (player.y > level.height + 160) hurt('fall');

    // --- chegada ---
    if (!player.finished && now > 0 && player.x >= level.finishX) { player.finished = true; play('finish'); if (hooks.onFinish) hooks.onFinish({ coins: player.coins, time: now }); }

    player.animTime += dt;

    // --- câmera ---
    const targetX = player.x - W * 0.45;
    camera.x += (targetX - camera.x) * Math.min(1, dt * 8);
    camera.x = Math.max(0, Math.min(level.width - W, camera.x));
    const targetY = Math.min(0, player.y - BH - CAMERA_TOP_MARGIN);
    if (targetY < camera.y) camera.y = targetY; else camera.y += (targetY - camera.y) * Math.min(1, dt * 6);
    if (camera.y > -0.5) camera.y = 0;

    for (const r of remote.values()) { r.x += (r.tx - r.x) * Math.min(1, dt * 14); r.y += (r.ty - r.y) * Math.min(1, dt * 14); }

    if (hooks.onState) {
      const a = player.hitUntil > 0 ? 'h' : !player.onGround ? 'j' : player.vx !== 0 ? 'w' : 'i';
      const s = { x: Math.round(player.x), y: Math.round(player.y), f: player.facing, a };
      const key = `${s.x},${s.y},${s.f},${s.a}`;
      if (key !== lastSent) { lastSent = key; hooks.onState(s); }
    }
  }

  // ---------- render ----------
  function drawBackground() {
    ctx.fillStyle = SKY_COLOR; ctx.fillRect(0, 0, W, H);
    for (const l of bgLayers) {
      const off = -Math.round((camera.x * l.factor) % l.width);
      ctx.save(); ctx.translate(off, l.top - Math.round(camera.y * l.factor)); ctx.fillStyle = l.pattern; ctx.fillRect(-off, 0, W, l.height); ctx.restore();
    }
  }
  function drawLevel() {
    const cx = Math.round(camera.x), cy = Math.round(camera.y);
    const c0 = Math.max(0, Math.floor(cx / TILE)), c1 = Math.min(level.cols - 1, Math.ceil((cx + W) / TILE));
    const blink = Math.floor(now * 4) % 2;
    for (let r = 0; r < level.rows; r++) for (let c = c0; c <= c1; c++) {
      const cell = cellAt(r, c);
      if (!cell) continue;
      let s = cell.s;
      if (cell.k === 'coin') { if (isCollected(r, c)) continue; if (blink && s.startsWith('coin')) s += '_side'; }
      else if (cell.k === 'spring') { const at = springs.get(r + ',' + c); if (at !== undefined && now - at < 0.25) s = 'spring_out'; }
      else if (s === 'torch_on_a' && blink) s = 'torch_on_b';
      else if (s === 'flag_red_a' && blink) s = 'flag_red_b';
      else if (s === 'flag_green_a' && blink) s = 'flag_green_b';
      draw(s, c * TILE - cx, r * TILE - cy);
    }
  }
  function drawEnemies() {
    const t = Math.max(0, now);
    level.entities.forEach((e, i) => {
      if (dead.has(i)) return;
      const p = enemyPose(e, t);
      if (p.x < camera.x - 80 || p.x > camera.x + W + 80) return;
      draw(enemySprite(e, t), Math.round(p.x - 32 - camera.x), Math.round(p.y - 64 - camera.y), p.dir > 0);
    });
  }
  function charSprite(color, anim, t) {
    const c = COLORS.includes(color) ? color : 'green';
    if (anim === 'h') return `character_${c}_hit`;
    if (anim === 'j') return `character_${c}_jump`;
    if (anim === 'w') return Math.floor(t * 8) % 2 ? `character_${c}_walk_a` : `character_${c}_walk_b`;
    return `character_${c}_idle`;
  }
  function drawCharacter(x, y, facing, sprite, nick, alpha) {
    const sx = Math.round(x - camera.x), sy = Math.round(y - camera.y);
    if (sx < -150 || sx > W + 150) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    draw(sprite, sx - 64, sy - 128, facing < 0);
    ctx.restore();
    if (nick) {
      ctx.save();
      ctx.font = '600 14px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(20,40,60,.55)'; ctx.fillStyle = '#fff';
      ctx.strokeText(nick, sx, sy - 104); ctx.fillText(nick, sx, sy - 104);
      ctx.restore();
    }
  }
  function drawOverlay() {
    if (now >= 1 || now < -4) return;
    const label = now < 0 ? String(Math.ceil(-now)) : 'VAI!';
    ctx.save();
    ctx.font = '700 96px Fredoka, Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(15,61,33,.8)'; ctx.fillStyle = now < 0 ? '#fff' : '#62d37a';
    ctx.strokeText(label, W / 2, H * 0.38); ctx.fillText(label, W / 2, H * 0.38);
    ctx.restore();
  }
  let lastTick = 99;
  function render() {
    drawBackground(); drawLevel(); drawEnemies();
    const t = performance.now() / 1000;
    for (const r of remote.values()) drawCharacter(r.x, r.y, r.f, charSprite(r.color, r.a, t), r.nick, 0.92);
    const anim = player.hitUntil > 0 ? 'h' : !player.onGround ? 'j' : player.vx !== 0 ? 'w' : 'i';
    const blink = player.invuln > 0 && Math.floor(player.animTime * 12) % 2 === 0;
    drawCharacter(player.x, player.y, player.facing, charSprite(player.color, anim, player.animTime), player.nick, blink ? 0.35 : 1);
    drawOverlay();
    const tick = Math.ceil(-now);
    if (now < 0 && tick <= 3 && tick !== lastTick) { lastTick = tick; play('tick'); }
  }

  function frame(ts) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    update(dt); render();
    raf = requestAnimationFrame(frame);
  }

  // ---------- API ----------
  function load(targetCanvas) {
    canvas = targetCanvas; ctx = canvas.getContext('2d');
    if (loaded) return loaded;
    loaded = (async () => {
      await Promise.all(SHEETS.map(loadSheet));
      for (const [k, file] of Object.entries(SOUNDS)) { try { const a = new Audio(`assets/sounds/${file}.ogg`); a.preload = 'auto'; sounds[k] = a; } catch {} }
    })();
    return loaded;
  }

  // Começa (ou recomeça) uma corrida. { seed, startAt (relógio do servidor), serverNow, color, nick, onState, onFinish }
  function startRace(opts) {
    level = Level.generate(opts.seed);
    collected.clear(); dead.clear(); springs = new Map();
    remote.clear();
    clockOffset = opts.serverNow - Date.now();
    startAt = opts.startAt;
    hooks = { onState: opts.onState, onFinish: opts.onFinish };
    Object.assign(player, { x: level.spawnX, y: level.spawnY, vx: 0, vy: 0, facing: 1, onGround: true, coyote: 0, jumpBuffer: 0, bouncing: false, coins: 0, invuln: 0, hitUntil: 0, finished: false, color: COLORS.includes(opts.color) ? opts.color : 'green', nick: opts.nick || '' });
    camera.x = 0; camera.y = 0; frozen = false; lastSent = ''; lastTick = 99;
    buildBackground(level.bg);
    if (!running) {
      keys.clear(); Object.assign(virt, { left: false, right: false, jump: false });
      addEventListener('keydown', onKeyDown); addEventListener('keyup', onKeyUp); addEventListener('blur', onBlur);
      running = true; last = performance.now(); raf = requestAnimationFrame(frame);
    }
  }
  function stop() {
    running = false; cancelAnimationFrame(raf);
    removeEventListener('keydown', onKeyDown); removeEventListener('keyup', onKeyUp); removeEventListener('blur', onBlur);
    hooks = {};
  }
  function setFrozen(v) { frozen = v; }
  function setRemote(list) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.peer);
      const cur = remote.get(p.peer);
      if (cur) Object.assign(cur, { tx: p.x, ty: p.y, f: p.f, a: p.a, color: p.color, nick: p.nick });
      else remote.set(p.peer, { x: p.x, y: p.y, tx: p.x, ty: p.y, f: p.f, a: p.a, color: p.color, nick: p.nick });
    }
    for (const k of remote.keys()) if (!seen.has(k)) remote.delete(k);
  }
  const stats = () => ({ time: now, coins: player.coins, finished: player.finished, progress: level ? Math.min(1, Math.max(0, player.x / level.finishX)) : 0 });
  function setMuted(v) { muted = v; }

  // gancho para testes automatizados (node): roda a física sem canvas
  const __test = { update, player, keys, setLevel: (l, sa) => { level = l; startAt = sa; clockOffset = 0; } };

  return { load, startRace, stop, setRemote, setVirtualInput, setFrozen, stats, setMuted, COLORS, W, H, __test };
})();
if (typeof module === 'object' && module.exports) module.exports = Game;
