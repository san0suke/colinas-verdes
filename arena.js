// Modo Arena (combate, visão de cima): mapa procedural da Super Retro Collection, heróis do Pixel Hero Maker,
// 3 corações, ataque com espada; o último vivo vence. Mesma API do motor da corrida (load/start/stop/setRemote…).
const Arena = (() => {
  const TILE = 16, S = 4, TS = TILE * S;          // tiles de 16 px desenhados em 4× (64 px)
  const W = 960, H = 576;
  const HERO_SCALE = 4;                           // herói ≈ 1 tile
  const SPEED = 230, MAX_HP = 3;
  const ATTACK_TIME = 0.34, ATTACK_HIT_AT = 0.12, ATTACK_CD = 0.55, ATTACK_RANGE = 72, ATTACK_HALF_H = 40;
  const HIT_INVULN = 1.0, KNOCKBACK = 300, RADIUS = 11; // raio da caixa de colisão nos pés
  const DASH_SPEED = 720, DASH_TIME = 0.18, DASH_CD = 0.6;    // dash sem limite de usos, com um intervalo curto entre eles

  let canvas, ctx, loaded = null;
  let atlas = null, retro = null;                 // imagem do atlas + índice (tiles/objetos)
  let heartsImg = null, heartRects = null;        // corações do Kenney
  let level = null, ground = null;                // ground: canvas pré-renderizado do chão
  const player = { id: '', x: 0, y: 0, vx: 0, vy: 0, facing: 1, hp: MAX_HP, alive: true, attackT: -1, cd: 0, invuln: 0, hurtT: 0, kx: 0, ky: 0, hero: null, nick: '', animTime: 0, deadAt: 0 };
  const remote = new Map();
  const camera = { x: 0, y: 0 };
  let running = false, raf = 0, last = 0, frozen = false;
  let startAt = 0, clockOffset = 0, now = 0, hooks = {}, lastSent = '', hitSent = new Set();
  let muted = false; const sounds = {};
  const SOUNDS = { swing: 'sfx_throw', hit: 'sfx_hurt', die: 'sfx_disappear', tick: 'sfx_select', win: 'sfx_magic', bump: 'sfx_bump' };
  function play(n) { if (muted || !sounds[n]) return; try { const a = sounds[n].cloneNode(); a.volume = 0.5; a.play().catch(() => {}); } catch {} }
  const serverNow = () => Date.now() + clockOffset;
  const raceTime = () => (serverNow() - startAt) / 1000;

  // ---------- input ----------
  const keys = new Set();
  const ATTACK_KEYS = ['Space', 'KeyJ', 'KeyK', 'Enter'];
  const DASH_KEYS = ['ShiftLeft', 'ShiftRight'];
  let attackPressed = false, dashPressed = false;
  function onKeyDown(e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (ATTACK_KEYS.includes(e.code) || e.code.startsWith('Arrow')) e.preventDefault();
    if (ATTACK_KEYS.includes(e.code) && !keys.has(e.code)) attackPressed = true;
    if (DASH_KEYS.includes(e.code) && !keys.has(e.code)) { dashPressed = true; e.preventDefault(); }
    keys.add(e.code);
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onBlur() { keys.clear(); }
  const virt = { left: false, right: false, up: false, down: false, jump: false, dash: false };
  function setVirtualInput(p) { if (p.jump && !virt.jump) attackPressed = true; if (p.dash && !virt.dash) dashPressed = true; Object.assign(virt, p); }
  const axis = () => ({
    x: (virt.right || keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (virt.left || keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0),
    y: (virt.down || keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (virt.up || keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0),
  });

  // ---------- mapa ----------
  const blockedAt = (x, y) => { const c = Math.floor(x / TS), r = Math.floor(y / TS); return r < 0 || c < 0 || r >= level.rows || c >= level.cols || level.blocked[r][c]; };
  function collides(x, y) { // caixa dos pés: 2·RADIUS de largura, RADIUS de altura
    return blockedAt(x - RADIUS, y - 2) || blockedAt(x + RADIUS, y - 2) || blockedAt(x - RADIUS, y - RADIUS) || blockedAt(x + RADIUS, y - RADIUS);
  }
  function drawTile(g, rect, dx, dy, sx, sy) { // pedaço 16×16 da textura (com offset para texturas maiores)
    g.drawImage(atlas, rect.x + (sx || 0), rect.y + (sy || 0), TILE, TILE, dx, dy, TS, TS);
  }
  function prerenderGround() {
    ground = document.createElement('canvas'); ground.width = level.width * S; ground.height = level.height * S;
    const g = ground.getContext('2d'); g.imageSmoothingEnabled = false;
    const t = retro.tiles;
    for (let r = 0; r < level.rows; r++) for (let c = 0; c < level.cols; c++) {
      const k = level.ground[r][c];
      const groundTile = level.biome === 'winter' ? t.snow : level.biome === 'desert' ? t.sand : t.grass;
      const pathTile = level.biome === 'desert' ? t.grass : t.dirt;
      if (k === 'w') drawTile(g, t.water, c * TS, r * TS, (c % 3) * TILE, (r % 3) * TILE);
      else drawTile(g, k === 'd' ? pathTile : groundTile, c * TS, r * TS);
    }
    // decoração no chão
    for (const o of level.objects) if (o.deco) drawObject(g, o, 0, 0);
  }
  function drawObject(g, o, camX, camY) {
    const bm = (retro.biomes && retro.biomes[level.biome]) || retro.objects;
    let list = bm[o.kind] || [];
    if (!list.length) list = bm.bush && bm.bush.length ? bm.bush : retro.objects[o.kind]; // deserto: cactos no lugar de árvores
    if (!list.length) return;
    const spr = list[o.idx % list.length];
    // âncora: base centrada no tile de apoio (linha ty+th-1)
    const bx = (o.tx + o.tw / 2) * TS, by = (o.ty + o.th) * TS;
    g.drawImage(atlas, spr.x, spr.y, spr.w, spr.h, Math.round(bx - spr.w * S / 2 - camX), Math.round(by - spr.h * S - camY), spr.w * S, spr.h * S);
  }

  // ---------- update ----------
  function update(dt) {
    now = raceTime();
    const active = now >= 0 && !frozen && player.alive;
    const a = active ? axis() : { x: 0, y: 0 };
    let vx = a.x, vy = a.y;
    if (vx && vy) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }
    if (a.x) player.facing = a.x;
    if (!active) attackPressed = false;

    // ataque
    player.cd = Math.max(0, player.cd - dt);
    if (attackPressed && active && player.cd <= 0 && player.attackT < 0) { player.attackT = 0; player.cd = ATTACK_CD; hitSent.clear(); play('swing'); if (hooks.onAttack) hooks.onAttack(); }
    attackPressed = false;
    if (player.attackT >= 0) {
      player.attackT += dt;
      if (player.attackT >= ATTACK_HIT_AT) { // golpe: retângulo à frente
        const x0 = player.facing > 0 ? player.x : player.x - ATTACK_RANGE, x1 = player.facing > 0 ? player.x + ATTACK_RANGE : player.x;
        for (const [id, r] of remote) {
          if (!r.alive || hitSent.has(id)) continue;
          if (r.x + 14 > x0 && r.x - 14 < x1 && Math.abs((r.y - 20) - (player.y - 20)) < ATTACK_HALF_H) { hitSent.add(id); if (hooks.onHit) hooks.onHit(id); }
        }
      }
      if (player.attackT >= ATTACK_TIME) player.attackT = -1;
    }
    // dash
    player.dashCd = Math.max(0, (player.dashCd || 0) - dt);
    if (dashPressed && active && player.dashCd <= 0 && player.attackT < 0) {
      const len = Math.hypot(vx, vy); const dx = len ? vx / len : player.facing, dy = len ? vy / len : 0;
      player.dashT = DASH_TIME; player.dashDx = dx; player.dashDy = dy; player.dashCd = DASH_CD; play('bump');
    }
    dashPressed = false;
    if (player.dashT > 0) { player.dashT -= dt; vx = player.dashDx; vy = player.dashDy; }
    // knockback decai
    player.kx *= Math.pow(0.02, dt); player.ky *= Math.pow(0.02, dt);
    const spd = player.dashT > 0 ? DASH_SPEED : player.attackT >= 0 ? SPEED * 0.4 : SPEED;
    player.vx = vx; player.vy = vy;
    const mx = vx * spd * dt + player.kx * dt, my = vy * spd * dt + player.ky * dt;
    if (!collides(player.x + mx, player.y)) player.x += mx;
    if (!collides(player.x, player.y + my)) player.y += my;
    player.x = Math.max(TS, Math.min(level.width * S - TS, player.x)); player.y = Math.max(TS + 8, Math.min(level.height * S - TS, player.y));
    player.invuln = Math.max(0, player.invuln - dt); player.hurtT = Math.max(0, player.hurtT - dt);
    player.animTime += dt;

    // câmera
    const tx = player.x - W / 2, ty = player.y - H / 2 - 20;
    camera.x += (tx - camera.x) * Math.min(1, dt * 8); camera.y += (ty - camera.y) * Math.min(1, dt * 8);
    camera.x = Math.max(0, Math.min(level.width * S - W, camera.x)); camera.y = Math.max(0, Math.min(level.height * S - H, camera.y));

    for (const r of remote.values()) { r.x += (r.tx - r.x) * Math.min(1, dt * 14); r.y += (r.ty - r.y) * Math.min(1, dt * 14); if (r.attackT >= 0) { r.attackT += dt; if (r.attackT > ATTACK_TIME) r.attackT = -1; } }

    if (hooks.onState) {
      const an = animOf(player);
      const s = { x: Math.round(player.x), y: Math.round(player.y), f: player.facing, a: an };
      const key = `${s.x},${s.y},${s.f},${s.a}`;
      if (key !== lastSent) { lastSent = key; hooks.onState(s); }
    }
  }
  function animOf(p) {
    if (!p.alive) return 'd';
    if (p.hurtT > 0) return 'h';
    if (p.attackT >= 0) return 'a';
    if (p.dashT > 0) return 'w';
    return (p.vx || p.vy) ? 'w' : 'i';
  }

  // ---------- render ----------
  function drawHeroAt(p, x, y, anim, t, alpha) {
    const sx = Math.round(x - camera.x), sy = Math.round(y - camera.y);
    ctx.save(); ctx.globalAlpha = alpha;
    const ok = p.hero && Hero.draw(ctx, p.hero, anim, t, sx, sy, p.facing < 0, HERO_SCALE);
    if (!ok) { ctx.fillStyle = '#3fbf6a'; ctx.fillRect(sx - 12, sy - 48, 24, 48); }
    ctx.restore();
    // nome e corações
    ctx.save();
    ctx.font = '700 13px "Baloo 2", Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(20,40,60,.6)'; ctx.fillStyle = '#fff';
    if (p.nick) { ctx.strokeText(p.nick, sx, sy - 78); ctx.fillText(p.nick, sx, sy - 78); }
    for (let i = 0; i < MAX_HP; i++) drawHeart(sx - 21 + i * 15, sy - 74, 13, i < p.hp);
    ctx.restore();
  }
  function drawHeart(x, y, size, full) {
    if (!heartsImg) return;
    const r = full ? heartRects.full : heartRects.empty;
    ctx.drawImage(heartsImg, r.x, r.y, r.w, r.h, x, y, size, size);
  }
  function render() {
    ctx.fillStyle = '#1d3b2a'; ctx.fillRect(0, 0, W, H);
    const cx = Math.round(camera.x), cy = Math.round(camera.y);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ground, cx, cy, W, H, 0, 0, W, H);
    // objetos e personagens ordenados pela base (y)
    const t = performance.now() / 1000;
    const items = [];
    for (const o of level.objects) if (!o.deco) { const by = (o.ty + o.th) * TS, bx = (o.tx + o.tw / 2) * TS; if (bx > cx - 200 && bx < cx + W + 200 && by > cy - 50 && by < cy + H + 300) items.push({ y: by - 4, draw: () => drawObject(ctx, o, cx, cy) }); }
    for (const r of remote.values()) items.push({ y: r.y, draw: () => { const hurtFor = r.hurtAt ? (performance.now() - r.hurtAt) / 1000 : 99; const blink = hurtFor < HIT_INVULN && Math.floor(hurtFor * 12) % 2 === 0; drawHeroAt(r, r.x, r.y, r.a === 'a' ? 'a' : r.a, r.a === 'a' && r.attackT >= 0 ? r.attackT : t, r.alive ? (blink ? 0.35 : 1) : 0.6); } });
    items.push({ y: player.y, draw: () => { const blink = player.invuln > 0 && Math.floor(player.animTime * 12) % 2 === 0; drawHeroAt(player, player.x, player.y, animOf(player), player.attackT >= 0 ? player.attackT : player.animTime, player.alive ? (blink ? 0.35 : 1) : 0.6); } });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    // HUD: corações grandes
    for (let i = 0; i < MAX_HP; i++) drawHeart(16 + i * 40, 12, 36, i < player.hp);
    // contagem / eliminado
    ctx.save();
    ctx.font = '400 84px "Lilita One", Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(15,40,30,.8)';
    if (now < 1 && now > -4) { const label = now < 0 ? String(Math.ceil(-now)) : 'LUTE!'; ctx.fillStyle = now < 0 ? '#fff' : '#ffd24a'; ctx.strokeText(label, W / 2, H * 0.38); ctx.fillText(label, W / 2, H * 0.38); }
    else if (!player.alive && !frozen) { ctx.font = '400 40px "Lilita One", Fredoka, sans-serif'; ctx.fillStyle = '#fff'; ctx.strokeText('Você foi eliminado — assistindo', W / 2, 60); ctx.fillText('Você foi eliminado — assistindo', W / 2, 60); }
    ctx.restore();
    const tick = Math.ceil(-now); if (now < 0 && tick <= 3 && tick !== lastTick) { lastTick = tick; play('tick'); }
  }
  let lastTick = 99;
  function frame(ts) { if (!running) return; const dt = Math.max(0, Math.min(0.05, (ts - last) / 1000)); last = ts; update(dt); render(); raf = requestAnimationFrame(frame); }

  // ---------- API ----------
  function load(targetCanvas) {
    canvas = targetCanvas; ctx = canvas.getContext('2d');
    if (loaded) return loaded;
    loaded = (async () => {
      const img = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
      [atlas, retro, heartsImg] = await Promise.all([img('assets/retro/atlas.png'), fetch('assets/retro/index.json').then((r) => r.json()), img('assets/sheets/spritesheet-tiles-default.png')]);
      const xml = await fetch('assets/sheets/spritesheet-tiles-default.xml').then((r) => r.text());
      const rect = (name) => { const m = xml.match(new RegExp('name="' + name + '" x="(\\d+)" y="(\\d+)" width="(\\d+)" height="(\\d+)"')); return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] }; };
      heartRects = { full: rect('hud_heart'), empty: rect('hud_heart_empty') };
      for (const [k, f] of Object.entries(SOUNDS)) { try { const a = new Audio(`assets/sounds/${f}.ogg`); a.preload = 'auto'; sounds[k] = a; } catch {} }
      await Hero.load();
    })();
    return loaded;
  }
  // { seed, startAt, serverNow, clockOffset, id, hero, nick, hp, alive, spawn:{x,y} (px do mapa em 1×), onState, onAttack, onHit }
  function start(opts) {
    level = ArenaLevel.generate(opts.seed, (bm) => Object.fromEntries(Object.entries((retro.biomes && retro.biomes[bm]) || retro.objects).map(([k, v]) => [k, v.length])));
    prerenderGround();
    remote.clear(); hitSent.clear();
    clockOffset = Number.isFinite(opts.clockOffset) ? opts.clockOffset : opts.serverNow - Date.now();
    startAt = opts.startAt;
    hooks = { onState: opts.onState, onAttack: opts.onAttack, onHit: opts.onHit };
    const sp = opts.spawn || level.spawns[0];
    Object.assign(player, { id: opts.id || '', x: sp.x * S, y: sp.y * S, vx: 0, vy: 0, facing: 1, hp: opts.hp == null ? MAX_HP : opts.hp, alive: opts.alive !== false, attackT: -1, cd: 0, invuln: 0, hurtT: 0, kx: 0, ky: 0, hero: opts.hero ? Hero.decode(opts.hero) : null, nick: opts.nick || '', animTime: 0, dashT: 0, dashCd: 0, dashDx: 1, dashDy: 0 });
    camera.x = Math.max(0, Math.min(level.width * S - W, player.x - W / 2)); camera.y = Math.max(0, Math.min(level.height * S - H, player.y - H / 2));
    frozen = false; lastSent = ''; lastTick = 99;
    if (!running) {
      keys.clear(); Object.assign(virt, { left: false, right: false, up: false, down: false, jump: false, dash: false });
      addEventListener('keydown', onKeyDown); addEventListener('keyup', onKeyUp); addEventListener('blur', onBlur);
      running = true; last = performance.now(); raf = requestAnimationFrame(frame);
    }
  }
  function stop() { running = false; cancelAnimationFrame(raf); removeEventListener('keydown', onKeyDown); removeEventListener('keyup', onKeyUp); removeEventListener('blur', onBlur); hooks = {}; }
  function setFrozen(v) { frozen = v; }
  function setClockOffset(v) { if (Number.isFinite(v)) clockOffset = v; }
  const heroCache = new Map();
  const parseHero = (s) => { if (!s) return null; if (!heroCache.has(s)) heroCache.set(s, Hero.decode(s)); return heroCache.get(s); };
  // list: [{ peer, x, y, f, a, hero, nick, hp, alive }]
  function setRemote(list) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.peer);
      const cur = remote.get(p.peer);
      const base = { tx: p.x, ty: p.y, f: p.f, a: p.a, hero: parseHero(p.hero), nick: p.nick, hp: p.hp == null ? MAX_HP : p.hp, alive: p.alive !== false };
      if (cur) { if (p.a === 'a' && cur.a !== 'a') cur.attackT = 0; Object.assign(cur, base); }
      else remote.set(p.peer, Object.assign({ x: p.x, y: p.y, attackT: -1, hurtAt: 0, facing: p.f }, base));
      const r = remote.get(p.peer); r.facing = p.f;
    }
    for (const k of remote.keys()) if (!seen.has(k)) remote.delete(k);
  }
  // dano vindo do servidor: { id, hp, kx, ky }
  function applyDamage(m) {
    if (m.id === player.id) {
      player.hp = m.hp; player.invuln = HIT_INVULN; player.hurtT = 0.4; player.kx = (m.kx || 0) * KNOCKBACK; player.ky = (m.ky || 0) * KNOCKBACK; play('hit');
      if (player.hp <= 0) { player.alive = false; play('die'); }
    } else {
      const r = remote.get(m.id); if (!r) return;
      r.hp = m.hp; r.hurtAt = performance.now(); if (r.hp <= 0) r.alive = false;
    }
  }
  function remoteAttack(id) { const r = remote.get(id); if (r) { r.attackT = 0; r.a = 'a'; } }
  const stats = () => ({ time: now, hp: player.hp, alive: player.alive, dashes: 4, dashMax: 4, coins: 0, boost: 0, finished: false });
  function setMuted(v) { muted = v; }
  return { load, start, stop, setRemote, setVirtualInput, setFrozen, setClockOffset, applyDamage, remoteAttack, stats, setMuted, MAX_HP, S, W, H };
})();
