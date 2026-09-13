// Motor do jogo: fase procedural (level.js), física com a grade de tiles, inimigos,
// moedas, molas, corrida com contagem regressiva e jogadores remotos.
// Assets: Kenney "New Platformer Pack" (CC0) — spritesheets em assets/sheets.

const Game = (() => {
  const COLORS = ['green', 'beige', 'pink', 'purple', 'yellow'];
  const TILE = 64;
  const W = 960, H = 576;

  // ---------- física ----------
  const GRAVITY = 2200, MAX_FALL = 1400;
  const MOVE_SPEED = 340, COIN_BOOST = 0.02, MAX_BOOST = 0.8, JUMP_SPEED = 820, JUMP_CUT = 0.45, COYOTE_TIME = 0.08, JUMP_BUFFER = 0.10;
  const GEM_VALUE = { gem_green: 5, gem_blue: 8, gem_red: 10, gem_yellow: 10 }; // gemas valem várias moedas
  const CRATE_GEMS = 3, STAR_DASHES = 3;    // caixa marrom: 3 gemas; estrela: +3 dashes (pode passar do máximo)
  const HW = 24, BH = 96;                 // meia-largura e altura da caixa do jogador (pés em y)
  const BOUNCE_SPEED = 1500;              // quique em cima de outro jogador
  const ENEMY_BOUNCE = 780, SPRING_SPEED = 1350;
  const STOMP_TOLERANCE = 14, CAMERA_TOP_MARGIN = 120;
  const HURT_INVULN = 1.6, HIT_ANIM = 0.45;
  const DASH_CHARGES = 4, DASH_SPEED = 1200, DASH_TIME = 0.22; // dash: 4 usos por corrida, forte e curto, sem gravidade
  const HURT_COIN_LOSS = 15;              // moedas perdidas a cada dano

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
  const player = { x: 0, y: 0, vx: 0, vy: 0, facing: 1, onGround: false, coyote: 0, jumpBuffer: 0, bouncing: false, animTime: 0, color: 'green', nick: '', coins: 0, invuln: 0, hitUntil: 0, lossUntil: 0, lossText: '', popUntil: 0, popText: '', finished: false };
  const camera = { x: 0, y: 0 };
  const remote = new Map();
  let running = false, raf = 0, last = 0, frozen = false;
  let startAt = 0, clockOffset = 0;       // startAt em relógio do servidor; clockOffset = servidor − local
  let hooks = {};
  let lastSent = '';
  let now = 0;                            // tempo da corrida (s), pode ser negativo na contagem

  const serverNow = () => Date.now() + clockOffset;
  // cada moeda +2 % de velocidade (gemas contam pelo valor delas), até +80 %
  const boost = () => Math.min(MAX_BOOST, player.coins * COIN_BOOST);
  const raceTime = () => (serverNow() - startAt) / 1000;

  // ---------- input ----------
  const keys = new Set();
  let jumpPressedThisFrame = false;
  const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'];
  const DASH_KEYS = ['ShiftLeft', 'ShiftRight'];
  let dashPressedThisFrame = false;
  function onKeyDown(e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (JUMP_KEYS.includes(e.code) || e.code.startsWith('Arrow')) e.preventDefault();
    if (JUMP_KEYS.includes(e.code) && !keys.has(e.code)) jumpPressedThisFrame = true;
    if (DASH_KEYS.includes(e.code) && !keys.has(e.code)) { dashPressedThisFrame = true; e.preventDefault(); }
    keys.add(e.code);
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onBlur() { keys.clear(); }
  const virt = { left: false, right: false, jump: false, dash: false };
  function setVirtualInput(patch) { if (patch.jump && !virt.jump) jumpPressedThisFrame = true; if (patch.dash && !virt.dash) dashPressedThisFrame = true; Object.assign(virt, patch); }
  const jumpHeld = () => virt.jump || JUMP_KEYS.some((k) => keys.has(k));
  const leftHeld = () => virt.left || keys.has('ArrowLeft') || keys.has('KeyA');
  const rightHeld = () => virt.right || keys.has('ArrowRight') || keys.has('KeyD');

  // ---------- grade ----------
  const broken = new Set();               // "r,c" de caixas quebradas (somem)
  const activated = new Set();            // "r,c" de blocos "!" já usados
  let items = [];                         // estrelas soltas: { x, y, vy, t }
  let particles = [];                     // gemas voando ao quebrar caixa: { x, y, vx, vy, t, s }
  // superfície da rampa na coluna do centro do jogador; null se não há rampa por perto
  function slopeAt(x, yFrom, yTo) {
    const c = Math.floor(x / TILE), fx = (x - c * TILE) / TILE;
    const r0 = Math.max(0, Math.floor((yFrom - 1) / TILE) - 1), r1 = Math.min(level.rows - 1, Math.floor(yTo / TILE) + 1);
    for (let r = r0; r <= r1; r++) {
      const cell = cellAt(r, c);
      if (cell && cell.k === 'slope') return r * TILE + cell.h0 + (cell.h1 - cell.h0) * fx;
    }
    return null;
  }
  const cellAt = (r, c) => { const x = (level.cells[r] && level.cells[r][c]) || null; return x && broken.has(r + ',' + c) ? null : x; };
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
    // perde moedas (e o bônus de velocidade que vinha delas)
    const lost = Math.min(HURT_COIN_LOSS, player.coins);
    player.coins -= lost;
    player.lossText = lost > 0 ? `−${lost}` : ''; player.lossUntil = 1.2;
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
    player.vx = dir * MOVE_SPEED * (1 + boost());
    if (dir !== 0) player.facing = dir;
    if (!active) { jumpPressedThisFrame = false; dashPressedThisFrame = false; player.jumpBuffer = 0; }

    // --- dash: impulso horizontal forte na direção em que olha, sem cair enquanto dura ---
    if (dashPressedThisFrame && active && player.dashes > 0 && player.dashTime <= 0 && !player.finished) {
      player.dashes--; player.dashTime = DASH_TIME; player.dashDir = player.facing; player.bouncing = false; play('spring');
    }
    dashPressedThisFrame = false;
    const dashing = player.dashTime > 0;
    if (dashing) { player.dashTime -= dt; player.vx = player.dashDir * DASH_SPEED; player.vy = 0; jumpPressedThisFrame = false; player.jumpBuffer = 0; }

    player.coyote = player.onGround ? COYOTE_TIME : Math.max(0, player.coyote - dt);
    if (jumpPressedThisFrame) player.jumpBuffer = JUMP_BUFFER; else player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);
    jumpPressedThisFrame = false;
    if (player.bouncing) { player.jumpBuffer = 0; player.coyote = 0; }
    if (player.jumpBuffer > 0 && player.coyote > 0) { player.vy = -JUMP_SPEED; player.onGround = false; player.coyote = 0; player.jumpBuffer = 0; play('jump'); }
    if (!jumpHeld() && player.vy < 0 && !player.bouncing) player.vy *= Math.pow(JUMP_CUT, dt * 60);

    if (!dashing) player.vy = Math.min(MAX_FALL, player.vy + GRAVITY * dt);
    player.invuln = Math.max(0, player.invuln - dt);
    player.hitUntil = Math.max(0, player.hitUntil - dt);
    player.lossUntil = Math.max(0, player.lossUntil - dt);
    player.popUntil = Math.max(0, player.popUntil - dt);
    const prevY = player.y;

    // --- horizontal ---
    const wasOnGround = player.onGround;
    player.x += player.vx * dt;
    player.x = Math.max(HW, Math.min(level.width - HW, player.x));
    {
      const onSlope = slopeAt(player.x, player.y - 4, player.y + 8) !== null;
      const r0 = Math.max(0, Math.floor((player.y - BH + 2) / TILE)), r1 = Math.min(level.rows - 1, Math.floor((player.y - 2) / TILE) - (onSlope ? 1 : 0));
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
    const sy = player.vy >= 0 ? slopeAt(player.x, prevY, player.y + (wasOnGround ? 28 : 0)) : null;
    if (sy !== null && (player.y >= sy - 2 || (wasOnGround && sy - player.y <= 28))) {
      player.y = sy; player.vy = 0; player.onGround = true; player.bouncing = false;
    } else if (player.vy >= 0) {
      const c0 = Math.floor((player.x - HW + 4) / TILE), c1 = Math.floor((player.x + HW - 4) / TILE);
      const r0 = Math.max(0, Math.floor((prevY - 1) / TILE)), r1 = Math.min(level.rows - 1, Math.floor(player.y / TILE));
      for (let r = r0; r <= r1 && !player.onGround; r++) for (let c = c0; c <= c1; c++) {
        const cell = cellAt(r, c);
        if (!cell) continue;
        const top = r * TILE;
        if (cell.k === 'solid' || ((cell.k === 'oneway' || cell.k === 'spring') && prevY <= top + 6)) {
          if (player.y >= top) {
            player.y = top; player.vy = 0; player.onGround = true; player.bouncing = false;
            if (cell.crate) { // caixa marrom quebra e solta 3 gemas
              broken.add(r + ',' + c); player.coins += CRATE_GEMS * GEM_VALUE.gem_green; play('gem'); player.onGround = false; player.vy = -420;
              for (let i = 0; i < CRATE_GEMS; i++) particles.push({ x: c * TILE + 32, y: top, vx: (i - 1) * 140, vy: -520, t: 0.7, s: 'gem_green' });
            } else if (cell.star && !activated.has(r + ',' + c)) { // bloco "!" solta uma estrela
              activated.add(r + ',' + c); play('pop');
              items.push({ x: c * TILE + 32, y: top, vy: -380, t: 0 });
            }
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
        if (cell.k === 'coin' && !isCollected(r, c)) { collected.add(r + ',' + c); const v = GEM_VALUE[cell.s] || 1; player.coins += v; play(v > 1 ? 'gem' : 'coin'); }
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
    // --- estrelas soltas e partículas ---
    for (const it of items) {
      it.t += dt; it.vy += GRAVITY * 0.6 * dt; it.y += it.vy * dt;
      const r = Math.floor((it.y - 1) / TILE), c = Math.floor(it.x / TILE), under = cellAt(r, c);
      if (it.vy > 0 && under && (under.k === 'solid' || under.k === 'oneway')) { it.y = r * TILE; it.vy = 0; }
      if (Math.abs(it.x - player.x) < HW + 24 && it.y > player.y - BH - 8 && it.y - 56 < player.y) { it.taken = true; player.dashes += STAR_DASHES; player.popText = `+${STAR_DASHES} 💨 dash`; player.popUntil = 1.6; play('finish'); }
    }
    items = items.filter((it) => !it.taken && it.y < level.height + 200);
    for (const p of particles) { p.t -= dt; p.vy += GRAVITY * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    particles = particles.filter((p) => p.t > 0);

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
      const a = player.hitUntil > 0 ? 'h' : (!player.onGround || player.dashTime > 0) ? 'j' : player.vx !== 0 ? 'w' : 'i';
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
      else if (cell.star && activated.has(r + ',' + c)) s = 'block_exclamation_active';
      else if (cell.k === 'spring') { const at = springs.get(r + ',' + c); if (at !== undefined && now - at < 0.25) s = 'spring_out'; }
      else if (cell.k === 'hazard' && (s.startsWith('water') || s.startsWith('lava'))) {
        // água/lava sobe e desce alguns pixels; a cópia abaixo cobre a fresta que a subida abriria no fundo
        const dy = Math.round(Math.sin(now * 2.5) * 4);
        draw(s, c * TILE - cx, r * TILE - cy + dy);
        if (!s.includes('_top')) draw(s, c * TILE - cx, (r + 1) * TILE - cy + dy);
        continue;
      }
      else if (s === 'torch_on_a' && blink) s = 'torch_on_b';
      else if (s === 'flag_red_a' && blink) s = 'flag_red_b';
      else if (s === 'flag_green_a' && blink) s = 'flag_green_b';
      draw(s, c * TILE - cx, r * TILE - cy, !!cell.flip);
    }
  }
  function drawItems() {
    for (const it of items) draw('star', Math.round(it.x - 32 - camera.x), Math.round(it.y - 64 - camera.y + Math.sin(it.t * 6) * 3));
    for (const p of particles) { ctx.save(); ctx.globalAlpha = Math.min(1, p.t * 2); draw(p.s, Math.round(p.x - 32 - camera.x), Math.round(p.y - 64 - camera.y)); ctx.restore(); }
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
    drawBackground(); drawLevel(); drawItems(); drawEnemies();
    const t = performance.now() / 1000;
    for (const r of remote.values()) drawCharacter(r.x, r.y, r.f, charSprite(r.color, r.a, t), r.nick, 0.92);
    const anim = player.hitUntil > 0 ? 'h' : (!player.onGround || player.dashTime > 0) ? 'j' : player.vx !== 0 ? 'w' : 'i';
    const blink = player.invuln > 0 && Math.floor(player.animTime * 12) % 2 === 0;
    drawCharacter(player.x, player.y, player.facing, charSprite(player.color, anim, player.animTime), player.nick, blink ? 0.35 : 1);
    if (player.popUntil > 0 && player.popText) {
      const sx = Math.round(player.x - camera.x), sy = Math.round(player.y - camera.y) - 150 - Math.round((1.6 - player.popUntil) * 45);
      ctx.save();
      ctx.globalAlpha = Math.min(1, player.popUntil * 1.5);
      ctx.font = '700 26px Fredoka, Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(10,40,80,.75)'; ctx.fillStyle = '#8fdcff';
      ctx.strokeText(player.popText, sx, sy); ctx.fillText(player.popText, sx, sy);
      ctx.restore();
    }
    if (player.lossUntil > 0 && player.lossText) {
      const sx = Math.round(player.x - camera.x), sy = Math.round(player.y - camera.y) - 130 - Math.round((1.2 - player.lossUntil) * 40);
      ctx.save();
      ctx.globalAlpha = Math.min(1, player.lossUntil * 2);
      ctx.font = '700 22px Fredoka, Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(20,40,60,.7)'; ctx.fillStyle = '#ffd24a';
      ctx.strokeText(player.lossText + ' 🪙', sx, sy); ctx.fillText(player.lossText + ' 🪙', sx, sy);
      ctx.restore();
    }
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
    collected.clear(); dead.clear(); broken.clear(); activated.clear(); items = []; particles = []; springs = new Map();
    remote.clear();
    clockOffset = opts.serverNow - Date.now();
    startAt = opts.startAt;
    hooks = { onState: opts.onState, onFinish: opts.onFinish };
    Object.assign(player, { x: level.spawnX, y: level.spawnY, vx: 0, vy: 0, facing: 1, onGround: true, coyote: 0, jumpBuffer: 0, bouncing: false, dashes: DASH_CHARGES, dashTime: 0, dashDir: 1, coins: 0, invuln: 0, hitUntil: 0, lossUntil: 0, lossText: '', popUntil: 0, popText: '', finished: false, color: COLORS.includes(opts.color) ? opts.color : 'green', nick: opts.nick || '' });
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
  const stats = () => ({ time: now, coins: player.coins, boost: boost(), dashes: player.dashes, dashMax: DASH_CHARGES, dashing: player.dashTime > 0, finished: player.finished, progress: level ? Math.min(1, Math.max(0, player.x / level.finishX)) : 0 });
  function setMuted(v) { muted = v; }

  // gancho para testes automatizados (node): roda a física sem canvas
  const __test = { update, player, keys, setLevel: (l, sa) => { level = l; startAt = sa; clockOffset = 0; } };

  return { load, startRace, stop, setRemote, setVirtualInput, setFrozen, stats, setMuted, COLORS, W, H, __test };
})();
if (typeof module === 'object' && module.exports) module.exports = Game;
