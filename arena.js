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
  let atlas = null, retro = null, autoImg = null, arrowImg = null, weaponLen = {};                 // imagem do atlas + índice (tiles/objetos)
  let heartsImg = null, heartRects = null;        // corações do Kenney
  let level = null, ground = null;                // ground: canvas pré-renderizado do chão
  const player = { id: '', x: 0, y: 0, vx: 0, vy: 0, facing: 1, hp: MAX_HP, alive: true, attackT: -1, cd: 0, invuln: 0, hurtT: 0, kx: 0, ky: 0, hero: null, nick: '', animTime: 0, deadAt: 0 };
  const remote = new Map();
  const camera = { x: 0, y: 0 };
  let running = false, raf = 0, last = 0, frozen = false, overview = false;
  let startAt = 0, clockOffset = 0, now = 0, hooks = {}, lastSent = '', hitSent = new Set();
  // ---- armas à distância: cajados/varinhas lançam magia do seu elemento, arcos atiram flechas ----
  const SHOT_SPEED = 540, SHOT_LIFE = 1.0, SHOT_CD = 1.2, SHOT_R = 26; // px/s, s de vida, recarga (maior que qualquer arma de perto), raio de acerto
  const SHOT_WINDUP = 0.4, SHOT_TIME = 0.6;                                 // preparação até o projétil sair; duração do gesto
  const ELEMENTS = [
    ['fire', /^(FireWand|FlameStaff|RedWand|RedStick)$/], ['ice', /^(BlueWand|BlueStick)$/], ['water', /^WaterWand$/], ['heart', /^AmurWand$/],
    ['nature', /^(NatureWand|GreenWand|CurveBranch|ArchStaff)$/], ['storm', /^StormStaff$/], ['dark', /^(NecromancerStaff|SkullWand|GoldenSkullWand|ElderStaff)$/],
    ['holy', /^(BishopStaff|PriestWand|WingedStaff|GoldenSkepter|MasterWand)$/],
  ];
  function weaponKind(hero) { // '' = corpo a corpo
    const w = (hero && hero.weapon) || '';
    if (/Bow/.test(w)) return 'arrow';
    if (/Staff|Wand|Stick|Skepter|Stuff|Branch/.test(w)) { for (const [k, re] of ELEMENTS) if (re.test(w)) return k; return 'magic'; }
    return '';
  }
  // corpo a corpo: comprimento da arma (px no sprite, ~10 faca … ~28 lança) → alcance e recarga; sem arma = soco
  function meleeStats(hero) {
    const w = (hero && hero.weapon) || '';
    const L = w ? (weaponLen[w] || 15) : 8, e = Math.max(0, L - 10);
    return { range: Math.round(40 + e * 6), cd: +(0.35 + e * 0.03).toFixed(2), time: +(0.3 + e * 0.012).toFixed(2) };
  }
  const shots = [], puffs = [];
  function spawnShot(x, y, dx, dy, kind, mine) { shots.push({ x, y, dx, dy, kind, mine, t: 0 }); }
  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i]; s.t += dt; s.x += s.dx * SHOT_SPEED * dt; s.y += s.dy * SHOT_SPEED * dt;
      let dead = s.t > SHOT_LIFE || blockedAt(s.x, s.y + 22); // o projétil voa na altura do peito; colide pelo tile "embaixo" dele
      if (!dead && s.mine) for (const [id, r] of remote) {
        if (!r.alive) continue;
        if (Math.hypot(r.x - s.x, (r.y - 22) - s.y) < SHOT_R) { if (hooks.onHit) hooks.onHit(id, true); dead = true; break; }
      }
      if (dead) { shots.splice(i, 1); puffs.push({ x: s.x, y: s.y, kind: s.kind, t: 0 }); }
    }
    for (let i = puffs.length - 1; i >= 0; i--) { puffs[i].t += dt; if (puffs[i].t > 0.25) puffs.splice(i, 1); }
  }
  const SHOT_COLORS = { fire: ['#ff7a1a', '#ffe066'], ice: ['#8fe3ff', '#ffffff'], water: ['#3d8dff', '#bfe6ff'], heart: ['#ff5c9a', '#ffd1e6'], nature: ['#4fd35a', '#d6ffb0'],
    storm: ['#ffe14a', '#ffffff'], dark: ['#6a2aa8', '#1a0630'], holy: ['#fff3b0', '#ffffff'], magic: ['#b56cff', '#ffffff'], arrow: ['#c98a4a', '#fff'] };
  function heartPath(r) { ctx.beginPath(); ctx.moveTo(0, r * 0.9); ctx.bezierCurveTo(-r * 1.4, -r * 0.2, -r * 0.6, -r * 1.2, 0, -r * 0.4); ctx.bezierCurveTo(r * 0.6, -r * 1.2, r * 1.4, -r * 0.2, 0, r * 0.9); ctx.closePath(); }
  function drawShot(s) {
    const sx = Math.round(s.x - camera.x), sy = Math.round(s.y - camera.y), [c1, c2] = SHOT_COLORS[s.kind] || SHOT_COLORS.magic;
    ctx.save(); ctx.translate(sx, sy);
    if (s.kind === 'arrow') { ctx.rotate(Math.atan2(s.dy, s.dx)); if (arrowImg) ctx.drawImage(arrowImg, 0, 0, 32, 32, -48, -48, 96, 96); ctx.restore(); return; }
    const w = Math.sin(s.t * 40) * 1.5; // pulsa
    ctx.rotate(Math.atan2(s.dy, s.dx));
    // rastro
    ctx.globalAlpha = 0.35; ctx.fillStyle = c1; for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(-k * 11, 0, 9 - k * 2, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (s.kind === 'heart') { ctx.rotate(-Math.atan2(s.dy, s.dx)); ctx.fillStyle = c1; heartPath(13 + w); ctx.fill(); ctx.fillStyle = c2; heartPath(6); ctx.fill(); }
    else if (s.kind === 'ice') { ctx.rotate(s.t * 6); ctx.fillStyle = c1; ctx.beginPath(); ctx.moveTo(0, -15 - w); ctx.lineTo(10, 0); ctx.lineTo(0, 15 + w); ctx.lineTo(-10, 0); ctx.closePath(); ctx.fill(); ctx.fillStyle = c2; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4, 0); ctx.lineTo(0, 7); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fill(); }
    else if (s.kind === 'storm') { ctx.strokeStyle = c1; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-5, -9 - w); ctx.lineTo(2, 3); ctx.lineTo(16, -6); ctx.stroke(); ctx.strokeStyle = c2; ctx.lineWidth = 2; ctx.stroke(); }
    else if (s.kind === 'fire') { ctx.fillStyle = c1; ctx.beginPath(); ctx.ellipse(0, 0, 17 + w, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = c2; ctx.beginPath(); ctx.ellipse(3, 0, 9, 6, 0, 0, Math.PI * 2); ctx.fill(); }
    else if (s.kind === 'holy') { ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(0, 0, 12 + w, 0, Math.PI * 2); ctx.fill(); ctx.rotate(s.t * 4); ctx.fillStyle = c2; ctx.beginPath(); for (let k = 0; k < 8; k++) { const r = k % 2 ? 5 : 15; ctx.lineTo(Math.cos(k * Math.PI / 4) * r, Math.sin(k * Math.PI / 4) * r); } ctx.closePath(); ctx.fill(); }
    else { ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(0, 0, 13 + w, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(2, -2, 6, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function drawPuff(p) {
    const sx = Math.round(p.x - camera.x), sy = Math.round(p.y - camera.y), [c1] = SHOT_COLORS[p.kind] || SHOT_COLORS.magic, k = p.t / 0.25;
    ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = c1; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(sx, sy, 8 + k * 26, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  const LAVA_TICK = 0.7;                       // s dentro da lava por coração perdido
  let lavaT = 0; // tempo dentro da lava
  const groundAt = (x, y) => { const c = Math.floor(x / TS), r = Math.floor(y / TS); return (r < 0 || c < 0 || r >= level.rows || c >= level.cols) ? 'k' : level.ground[r][c]; };
  let muted = false; const sounds = {};
  const SOUNDS = { swing: 'sfx_throw', hit: 'sfx_hurt', die: 'sfx_disappear', tick: 'sfx_select', win: 'sfx_magic', bump: 'sfx_bump', cast: 'sfx_magic' };
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
    if (e.metaKey || e.ctrlKey || e.altKey) return; // atalhos do sistema (ex.: Win+Shift+S para captura de tela) não viram dash
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
  // tiles de chão por caractere do mapa (rects no atlas; texturas maiores repetem por módulo)
  const GROUND = {
    g: { x: 480, y: 320, w: 16, h: 16 }, d: { x: 576, y: 482, w: 16, h: 16 }, s: { x: 384, y: 320, w: 16, h: 16 }, n: { x: 432, y: 320, w: 16, h: 16 },
    p: { x: 48, y: 528, w: 32, h: 32 }, w: { x: 192, y: 528, w: 48, h: 48 }, l: { x: 80, y: 528, w: 32, h: 32 },
  };
  const WALL_RING = { x: 869, y: 337, w: 48, h: 48 }; // anel de pedra cinza (9 fatias) para paredes da masmorra
  const isWall = (r, c) => r >= 0 && c >= 0 && r < level.rows && c < level.cols && level.ground[r][c] === 'W';
  const cellIs = (r, c, ch) => r >= 0 && c >= 0 && r < level.rows && c < level.cols && level.ground[r][c] === ch;
  // ---- grade dual (autotiles 4×4 do pacote em assets/retro/auto.png) ----
  // cada peça fica deslocada meio tile e é escolhida pelos 4 cantos que são do material: TL=1, TR=2, BL=4, BR=8 → [tx, ty] na grade 4×4
  const DUAL = [[0, 3], [3, 3], [0, 2], [1, 2], [0, 0], [3, 2], [2, 3], [3, 1], [1, 3], [0, 1], [1, 0], [2, 2], [3, 0], [2, 0], [1, 1], [2, 1]];
  const WATER_SET_Y = { village: 0, forest: 0, desert: 192, winter: 128, dungeon: 64 }; // linha do conjunto de água por tema (4 quadros de 64×64)
  const TRAIL_SET = { x: 0, y: 320 };                  // grama + terra alaranjada (1 quadro)
  const WF = { x: 64, y: 320 }, WF_FX = { x: 64, y: 336 }; // cachoeira: 3 colunas (esq/meio/dir) × 3 quadros; espuma da base 16×32 × 3 quadros
  const BASE_OF = { village: 'g', forest: 'g', desert: 's', winter: 'n', dungeon: 'p' }; // chão por baixo da água/cachoeira
  const LAVA_SET_Y = 256; // pedra + lava (4 quadros)
  let waterTiles = [], lavaTiles = [], wfTiles = [], wfFx = [];
  // lista de peças da grade dual para o caractere ch (vértices entre 4 células)
  function dualTiles(ch) {
    const out = [];
    for (let vr = 0; vr <= level.rows; vr++) for (let vc = 0; vc <= level.cols; vc++) {
      const m = (cellIs(vr - 1, vc - 1, ch) ? 1 : 0) | (cellIs(vr - 1, vc, ch) ? 2 : 0) | (cellIs(vr, vc - 1, ch) ? 4 : 0) | (cellIs(vr, vc, ch) ? 8 : 0);
      if (m) out.push({ x: vc * TS - TS / 2, y: vr * TS - TS / 2, tx: DUAL[m][0], ty: DUAL[m][1], m });
    }
    return out;
  }
  // camadas animadas (água, cachoeira) desenhadas por cima do chão pré-renderizado
  function drawWater(cx, cy, VW, VH, t) {
    if (!autoImg) return;
    const fr = Math.floor(t * 3) % 4, wy = WATER_SET_Y[level.theme] || 0;
    for (const w of waterTiles) if (w.x + TS > cx && w.x < cx + VW && w.y + TS > cy && w.y < cy + VH) ctx.drawImage(autoImg, fr * 64 + w.tx * TILE, wy + w.ty * TILE, TILE, TILE, w.x - cx, w.y - cy, TS, TS);
    for (const w of lavaTiles) if (w.x + TS > cx && w.x < cx + VW && w.y + TS > cy && w.y < cy + VH) ctx.drawImage(autoImg, fr * 64 + w.tx * TILE, LAVA_SET_Y + w.ty * TILE, TILE, TILE, w.x - cx, w.y - cy, TS, TS);
    const wf = Math.floor(t * 9) % 3;
    for (const w of wfTiles) ctx.drawImage(autoImg, WF.x + wf * 48 + w.col * TILE, WF.y, TILE, TILE, w.x - cx, w.y - cy, TS, TS);
    for (const w of wfFx) ctx.drawImage(autoImg, WF_FX.x + wf * TILE, WF_FX.y, TILE, TILE * 2, w.x - cx, w.y - cy, TS, TS * 2);
  }
  function prerenderGround() {
    ground = document.createElement('canvas'); ground.width = level.width * S; ground.height = level.height * S;
    const g = ground.getContext('2d'); g.imageSmoothingEnabled = false;
    g.fillStyle = '#0a0b14'; g.fillRect(0, 0, ground.width, ground.height);
    for (let r = 0; r < level.rows; r++) for (let c = 0; c < level.cols; c++) {
      const k = level.ground[r][c];
      if (k === 'k') continue;
      if (k === 'w' || k === 'f' || k === 'l') { const b = GROUND[BASE_OF[level.theme] || 'g']; drawTile(g, b, c * TS, r * TS, (c % (b.w / TILE)) * TILE, (r % (b.h / TILE)) * TILE); continue; } // água/cachoeira: chão por baixo, camada animada por cima
      if (k === 'd') { g.drawImage(autoImg, TRAIL_SET.x, TRAIL_SET.y + 48, TILE, TILE, c * TS, r * TS, TS, TS); continue; } // terra da trilha (peça cheia do conjunto)
      if (k === 'W') {
        drawTile(g, GROUND.p, c * TS, r * TS, (c % 2) * TILE, (r % 2) * TILE); // piso por baixo (o anel tem cantos transparentes)
        // 9 fatias do anel: escolhe pela vizinhança (linhas de 1 tile)
        const L = isWall(r, c - 1), R = isWall(r, c + 1), U = isWall(r - 1, c), D = isWall(r + 1, c);
        let sx = 16, sy = 0; // borda de cima (horizontal)
        if (R && D && !L && !U) { sx = 0; sy = 0; } else if (L && D && !R && !U) { sx = 32; sy = 0; }
        else if (R && U && !L && !D) { sx = 0; sy = 32; } else if (L && U && !R && !D) { sx = 32; sy = 32; }
        else if ((U || D) && !L && !R) { sx = 0; sy = 16; }
        else if (L && R && U && !D) { sx = 16; sy = 32; }
        g.drawImage(atlas, WALL_RING.x + sx, WALL_RING.y + sy, TILE, TILE, c * TS, r * TS, TS, TS);
        continue;
      }
      const t = GROUND[k] || GROUND.g;
      drawTile(g, t, c * TS, r * TS, (c % (t.w / TILE)) * TILE, (r % (t.h / TILE)) * TILE);
    }
    // beiradas da trilha (grade dual, estática)
    for (const d of dualTiles('d')) if (d.m !== 15) g.drawImage(autoImg, TRAIL_SET.x + d.tx * TILE, TRAIL_SET.y + d.ty * TILE, TILE, TILE, d.x, d.y, TS, TS);
    // lagos e cachoeira (animados no render)
    waterTiles = dualTiles('w'); lavaTiles = dualTiles('l'); wfTiles = []; wfFx = [];
    for (let r = 0; r < level.rows; r++) for (let c = 0; c < level.cols; c++) if (cellIs(r, c, 'f')) {
      wfTiles.push({ x: c * TS, y: r * TS, col: !cellIs(r, c - 1, 'f') ? 0 : !cellIs(r, c + 1, 'f') ? 2 : 1 });
      if (!cellIs(r + 1, c, 'f')) wfFx.push({ x: c * TS, y: r * TS }); // espuma na base (metade sobre a queda, metade sobre a água)
    }
    // decoração no chão
    for (const o of level.objects) if (o.deco) drawObject(g, o, 0, 0);
  }
  const rectCache = new Map();
  function rectOf(o) {
    if (rectCache.has(o.key)) return rectCache.get(o.key);
    const def = level.keys[o.key]; let spr = null;
    if (def) {
      if (def.rect) spr = { x: def.rect[0], y: def.rect[1], w: def.rect[2], h: def.rect[3] };
      else if (def.set === 'obj') { const l = retro.objects[def.kind]; spr = l && l[def.idx]; }
      else if (def.set === 'biome') { const l = retro.biomes && retro.biomes[def.biome] && retro.biomes[def.biome][def.kind]; spr = l && l[def.idx % (l.length || 1)]; }
      else { const l = retro.sets && retro.sets[def.set]; spr = l && l[def.idx]; }
    }
    rectCache.set(o.key, spr || null);
    return spr || null;
  }
  function drawObject(g, o, camX, camY) {
    const spr = rectOf(o);
    if (!spr) return;
    // âncora: base centrada no tile de apoio (linha ty+th-1)
    const bx = (o.tx + o.tw / 2) * TS, by = (o.ty + o.th) * TS;
    g.drawImage(atlas, spr.x, spr.y, spr.w, spr.h, Math.round(bx - spr.w * S / 2 - camX), Math.round(by - spr.h * S - camY), spr.w * S, spr.h * S);
  }

  // ---------- update ----------
  let autoFire = false, autoFireT = 0; // testes: atira sozinho a cada 0,5 s
  function update(dt) {
    now = raceTime();
    if (autoFire && now >= 0) { // testes (headless tem poucos quadros): mantém 4 projéteis parados em fila à frente do jogador
      const kind = weaponKind(player.hero) || 'magic'; while (shots.length < 4) spawnShot(player.x + 60 + shots.length * 70, player.y - 22, 1, 0, kind, false); for (const s of shots) s.t = 0.1;
      if (!puffs.length) puffs.push({ x: player.x + 350, y: player.y - 22, kind, t: 0.1 }); puffs[0].t = 0.1;
    }
    const active = now >= 0 && !frozen && player.alive;
    const a = active ? axis() : { x: 0, y: 0 };
    let vx = a.x, vy = a.y;
    if (vx && vy) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }
    if (a.x) player.facing = a.x;
    if (!active) attackPressed = false;

    // ataque
    player.cd = Math.max(0, player.cd - dt);
    if (attackPressed && active && player.cd <= 0 && player.attackT < 0) {
      const kind = weaponKind(player.hero);
      if (kind) { // à distância: começa a preparação; o projétil sai depois de SHOT_WINDUP (ver abaixo)
        player.attackT = 0; player.cd = SHOT_CD; player.ranged = true; player.shotKind = kind; player.shotFired = false; play(kind === 'arrow' ? 'swing' : 'cast'); if (hooks.onAttack) hooks.onAttack();
      } else { const ms = meleeStats(player.hero); player.attackT = 0; player.cd = ms.cd; player.range = ms.range; player.atkTime = ms.time; player.ranged = false; hitSent.clear(); play('swing'); if (hooks.onAttack) hooks.onAttack(); }
    }
    attackPressed = false;
    updateShots(dt);
    if (player.attackT >= 0) {
      player.attackT += dt;
      if (player.ranged && !player.shotFired && player.attackT >= SHOT_WINDUP && player.alive) { // solta o projétil: na direção do movimento; parado, para onde olha
        player.shotFired = true;
        const len = Math.hypot(vx, vy); const dx = len ? vx / len : player.facing, dy = len ? vy / len : 0;
        if (dx) player.facing = dx > 0 ? 1 : -1;
        const sx = player.x + dx * 22, sy = player.y - 22 + dy * 12, kind = player.shotKind || 'magic';
        spawnShot(sx, sy, dx, dy, kind, true);
        if (hooks.onShoot) hooks.onShoot({ x: Math.round(sx), y: Math.round(sy), dx: +dx.toFixed(3), dy: +dy.toFixed(3), kind });
      }
      if (player.attackT >= ATTACK_HIT_AT && !player.ranged) { // golpe: retângulo à frente
        const R = player.range || ATTACK_RANGE, x0 = player.facing > 0 ? player.x : player.x - R, x1 = player.facing > 0 ? player.x + R : player.x;
        for (const [id, r] of remote) {
          if (!r.alive || hitSent.has(id)) continue;
          if (r.x + 14 > x0 && r.x - 14 < x1 && Math.abs((r.y - 20) - (player.y - 20)) < ATTACK_HALF_H) { hitSent.add(id); if (hooks.onHit) hooks.onHit(id); }
        }
      }
      if (player.attackT >= (player.ranged ? SHOT_TIME : (player.atkTime || ATTACK_TIME))) player.attackT = -1;
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
    // lava (pelos pés): queima aos poucos enquanto o jogador fica dentro
    if (active) {
      if (groundAt(player.x, player.y - 4) === 'l') { lavaT += dt; if (lavaT >= LAVA_TICK) { lavaT = 0; if (hooks.onHazard) hooks.onHazard('lava'); } }
      else lavaT = LAVA_TICK * 0.6; // entra queimando logo
    }

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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1d3b2a'; ctx.fillRect(0, 0, W, H);
    let VW = W, VH = H;
    if (overview) { const k = Math.min(W / (level.width * S), H / (level.height * S)); camera.x = 0; camera.y = 0; VW = W / k; VH = H / k; ctx.setTransform(k, 0, 0, k, 0, 0); }
    const cx = Math.round(camera.x), cy = Math.round(camera.y);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ground, cx, cy, VW, VH, 0, 0, VW, VH);
    const t = performance.now() / 1000;
    drawWater(cx, cy, VW, VH, t);
    for (const o of level.objects) if (o.over) drawObject(ctx, o, cx, cy); // pontes: sobre a água, sob os personagens
    // objetos e personagens ordenados pela base (y)
    const items = [];
    for (const o of level.objects) if (!o.deco && !o.over) { const by = (o.ty + o.th) * TS, bx = (o.tx + o.tw / 2) * TS; if (bx > cx - 200 && bx < cx + VW + 200 && by > cy - 50 && by < cy + VH + 300) items.push({ y: by - 4, draw: () => drawObject(ctx, o, cx, cy) }); }
    for (const r of remote.values()) items.push({ y: r.y, draw: () => { const hurtFor = r.hurtAt ? (performance.now() - r.hurtAt) / 1000 : 99; const blink = hurtFor < HIT_INVULN && Math.floor(hurtFor * 12) % 2 === 0; drawHeroAt(r, r.x, r.y, r.a === 'a' ? 'a' : r.a, r.a === 'a' && r.attackT >= 0 ? r.attackT : t, r.alive ? (blink ? 0.35 : 1) : 0.6); } });
    items.push({ y: player.y, draw: () => { const blink = player.invuln > 0 && Math.floor(player.animTime * 12) % 2 === 0; drawHeroAt(player, player.x, player.y, animOf(player), player.attackT >= 0 ? player.attackT : player.animTime, player.alive ? (blink ? 0.35 : 1) : 0.6); } });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    for (const s of shots) drawShot(s);
    for (const p of puffs) drawPuff(p);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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
  // aba em segundo plano: o navegador pausa o rAF; um timer lento mantém o jogador "vivo" para os outros
  setInterval(() => { if (running && document.hidden) { update(0.25); last = performance.now(); } }, 250);
  function frame(ts) { if (!running) return; const dt = Math.max(0, Math.min(0.05, (ts - last) / 1000)); last = ts; update(dt); render(); raf = requestAnimationFrame(frame); }

  // ---------- API ----------
  function load(targetCanvas) {
    canvas = targetCanvas; ctx = canvas.getContext('2d');
    if (loaded) return loaded;
    loaded = (async () => {
      const img = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
      [atlas, retro, heartsImg, autoImg, arrowImg] = await Promise.all([img('assets/retro/atlas.png'), fetch('assets/retro/index.json').then((r) => r.json()), img('assets/sheets/spritesheet-tiles-default.png'), img('assets/retro/auto.png'), img('assets/retro/arrow.png')]);
      weaponLen = await fetch('assets/heroes/weapons.json').then((r) => r.json()).catch(() => ({}));
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
    level = Arenas.build(opts.seed | 0); // seed = índice da arena fixa
    rectCache.clear();
    prerenderGround();
    remote.clear(); hitSent.clear(); shots.length = 0; puffs.length = 0;
    autoFire = !!opts.autoFire;
    clockOffset = Number.isFinite(opts.clockOffset) ? opts.clockOffset : opts.serverNow - Date.now();
    startAt = opts.startAt;
    hooks = { onState: opts.onState, onAttack: opts.onAttack, onHit: opts.onHit, onHazard: opts.onHazard, onShoot: opts.onShoot };
    lavaT = 0;
    const sp = opts.spawn || level.spawns[0];
    Object.assign(player, { id: opts.id || '', x: sp.x * S, y: sp.y * S, vx: 0, vy: 0, facing: 1, hp: opts.hp == null ? MAX_HP : opts.hp, alive: opts.alive !== false, attackT: -1, cd: 0, invuln: 0, hurtT: 0, kx: 0, ky: 0, hero: opts.hero ? Hero.decode(opts.hero) : null, nick: opts.nick || '', animTime: 0, dashT: 0, dashCd: 0, dashDx: 1, dashDy: 0 });
    camera.x = Math.max(0, Math.min(level.width * S - W, player.x - W / 2)); camera.y = Math.max(0, Math.min(level.height * S - H, player.y - H / 2));
    frozen = false; lastSent = ''; lastTick = 99;
    if (hooks.onState) { const s = { x: Math.round(player.x), y: Math.round(player.y), f: player.facing, a: player.alive ? 'i' : 'd' }; lastSent = `${s.x},${s.y},${s.f},${s.a}`; hooks.onState(s); }
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
  function remoteShoot(m) { const r = remote.get(m.id); if (r) { if (r.attackT < 0) r.attackT = 0; r.a = 'a'; if (m.dx) r.facing = m.dx > 0 ? 1 : -1; } spawnShot(+m.x, +m.y, +m.dx, +m.dy, String(m.kind || 'magic'), false); }
  const stats = () => ({ time: now, hp: player.hp, alive: player.alive, dashes: 4, dashMax: 4, coins: 0, boost: 0, finished: false, arena: level ? level.name : '' });
  function setMuted(v) { muted = v; }
  function setOverview(v) { overview = !!v; }
  return { load, start, stop, setRemote, setVirtualInput, setFrozen, setClockOffset, applyDamage, remoteAttack, remoteShoot, stats, setMuted, setOverview, MAX_HP, S, W, H };
})();
