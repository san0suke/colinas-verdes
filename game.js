// Motor do jogo: chão + personagem com pulo + fundo parallax + jogadores remotos
// Assets: Kenney "New Platformer Pack" (CC0) — https://kenney.nl/assets/new-platformer-pack

const Game = (() => {
  const COLORS = ['green', 'beige', 'pink', 'purple', 'yellow'];
  const POSES = { idle: 'idle', jump: 'jump', walkA: 'walk_a', walkB: 'walk_b' };

  const ASSETS = {
    clouds:    'assets/bg/background_clouds.png',
    hillsFar:  'assets/bg/background_fade_hills.png',
    hillsNear: 'assets/bg/background_color_hills.png',
    groundTop: 'assets/tiles/terrain_grass_block_top.png',
    groundMid: 'assets/tiles/terrain_grass_block_center.png',
  };
  const CHAR_ASSETS = {
    green:  { idle: 'assets/char/character_green_idle.png',  jump: 'assets/char/character_green_jump.png',  walkA: 'assets/char/character_green_walk_a.png',  walkB: 'assets/char/character_green_walk_b.png' },
    beige:  { idle: 'assets/char/character_beige_idle.png',  jump: 'assets/char/character_beige_jump.png',  walkA: 'assets/char/character_beige_walk_a.png',  walkB: 'assets/char/character_beige_walk_b.png' },
    pink:   { idle: 'assets/char/character_pink_idle.png',   jump: 'assets/char/character_pink_jump.png',   walkA: 'assets/char/character_pink_walk_a.png',   walkB: 'assets/char/character_pink_walk_b.png' },
    purple: { idle: 'assets/char/character_purple_idle.png', jump: 'assets/char/character_purple_jump.png', walkA: 'assets/char/character_purple_walk_a.png', walkB: 'assets/char/character_purple_walk_b.png' },
    yellow: { idle: 'assets/char/character_yellow_idle.png', jump: 'assets/char/character_yellow_jump.png', walkA: 'assets/char/character_yellow_walk_a.png', walkB: 'assets/char/character_yellow_walk_b.png' },
  };

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Falha ao carregar ' + src.slice(0, 40)));
      img.src = src;
    });
  }

  // Os fundos do pack são opacos: a cor do pixel superior-esquerdo (céu/branco)
  // vira transparente para que as camadas possam ser empilhadas.
  // `pixel(r, g, b)` opcional decide o resto: false = transparente, [r, g, b] = recolore, outro = mantém.
  function keyOutTopColor(img, pixel) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height);
    const p = data.data;
    const r0 = p[0], g0 = p[1], b0 = p[2];
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], gg = p[i + 1], b = p[i + 2];
      if (r === r0 && gg === g0 && b === b0) { p[i + 3] = 0; continue; }
      if (!pixel) continue;
      const out = pixel(r, gg, b);
      if (out === false) p[i + 3] = 0;
      else if (Array.isArray(out)) { p[i] = out[0]; p[i + 1] = out[1]; p[i + 2] = out[2]; }
    }
    g.putImageData(data, 0, 0);
    return { canvas: c, keyColor: `rgb(${r0},${g0},${b0})` };
  }

  // Pré-escala a camada uma única vez (escala inteira) e cria um pattern repetido,
  // assim a emenda entre repetições nunca cai em coordenada fracionária.
  function makeLayer(ctx, keyed, scale) {
    const c = document.createElement('canvas');
    c.width = keyed.canvas.width * scale;
    c.height = keyed.canvas.height * scale;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(keyed.canvas, 0, 0, c.width, c.height);
    return { pattern: ctx.createPattern(c, 'repeat-x'), width: c.width, height: c.height };
  }

  // ---------- Mundo ----------
  const W = 960, H = 540;
  const TILE = 64;
  const GROUND_ROWS = 2;
  const GROUND_Y = H - TILE * GROUND_ROWS; // topo do chão
  const WORLD_COLS = 25;                   // largura do mapa em tiles (finito)
  const WORLD_W = WORLD_COLS * TILE;       // 1600 px ≈ 1,7 telas
  const EDGE = 12;                         // margem para o sprite não vazar na borda

  const GRAVITY = 2200;      // px/s²
  const MOVE_SPEED = 320;    // px/s
  const JUMP_SPEED = 820;    // px/s
  const JUMP_CUT = 0.45;     // multiplicador ao soltar o pulo cedo
  const COYOTE_TIME = 0.08;  // s
  const JUMP_BUFFER = 0.10;  // s

  // quique ao cair em cima de outro jogador
  const BODY_W = 60;             // largura considerada para "estar em cima" (px)
  const BODY_H = 104;            // altura do corpo (o sprite de 128 tem ar em cima)
  const BOUNCE_SPEED = 1050;     // px/s — mais forte que o pulo normal
  const STOMP_TOLERANCE = 14;    // px — quanto os pés podem já ter passado da cabeça no frame anterior

  // As imagens do pack misturam camadas: fade_hills tem morros claros (221,239,255) e uma faixa
  // mais escura (195,227,255) na frente; color_hills tem morros azuis atrás dos verdes. Cada uma
  // vira uma camada própria (src = imagem de origem, pixel = filtro) com velocidade e altura próprias;
  // quanto mais perto, mais rápido e mais baixo. offsetY > 0 desce a camada (o chão cobre a sobra).
  const LIGHT_BLUE = [221, 239, 255];
  const PARALLAX = [
    // nuvens: só as brancas — a imagem também traz nuvens azul-claras atrás, que pareciam uma 3ª camada de morros
    { key: 'clouds',    src: 'clouds',    factor: 0.10, scale: 2, offsetY: -120, pixel: (r) => r > 240 ? true : false },
    // morros claros: tudo que não é branco vira azul-claro (preenche o que a faixa escura cobria)
    { key: 'hillsFar',  src: 'hillsFar',  factor: 0.25, scale: 2, offsetY: -30, pixel: () => LIGHT_BLUE },
    // faixa azul mais escura: só ela, o resto some
    { key: 'hillsMid',  src: 'hillsFar',  factor: 0.40, scale: 2, offsetY: 10,  pixel: (r, g) => g < 232 ? true : false },
    // morros verdes: descarta os azuis desenhados atrás (azul dominante)
    { key: 'hillsNear', src: 'hillsNear', factor: 0.60, scale: 2, offsetY: 55,  pixel: (r, g, b) => b > g ? false : true },
  ];

  // ---------- Estado ----------
  let canvas, ctx;
  let img = {}, chars = {}, bg = {}, skyColor = '#cbe6ff';
  let loaded = null;

  const player = { x: 200, y: GROUND_Y, vx: 0, vy: 0, w: 56, facing: 1, onGround: true, coyote: 0, jumpBuffer: 0, animTime: 0, color: 'green', nick: '' };
  const camera = { x: 0 };
  const remote = new Map(); // peer -> { x, y, tx, ty, f, a, color, nick }

  let running = false, raf = 0, last = 0;
  let onState = null, lastSent = '';

  // ---------- Input ----------
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

  // entrada virtual (joystick e botão de pulo no celular), somada ao teclado
  const virt = { left: false, right: false, jump: false };
  function setVirtualInput(patch) {
    if (patch.jump && !virt.jump) jumpPressedThisFrame = true;
    Object.assign(virt, patch);
  }

  const jumpHeld = () => virt.jump || JUMP_KEYS.some((k) => keys.has(k));
  const leftHeld = () => virt.left || keys.has('ArrowLeft') || keys.has('KeyA');
  const rightHeld = () => virt.right || keys.has('ArrowRight') || keys.has('KeyD');

  // ---------- Update ----------
  function update(dt) {
    const dir = (rightHeld() ? 1 : 0) - (leftHeld() ? 1 : 0);
    player.vx = dir * MOVE_SPEED;
    if (dir !== 0) player.facing = dir;

    player.coyote = player.onGround ? COYOTE_TIME : Math.max(0, player.coyote - dt);
    if (jumpPressedThisFrame) player.jumpBuffer = JUMP_BUFFER;
    else player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);
    jumpPressedThisFrame = false;

    if (player.jumpBuffer > 0 && player.coyote > 0) {
      player.vy = -JUMP_SPEED;
      player.onGround = false;
      player.coyote = 0;
      player.jumpBuffer = 0;
    }
    if (!jumpHeld() && player.vy < 0) player.vy *= Math.pow(JUMP_CUT, dt * 60);

    player.vy += GRAVITY * dt;
    const prevY = player.y;
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // pisou na cabeça de outro jogador: quica para cima (efeito "pinball")
    if (player.vy > 0) {
      for (const r of remote.values()) {
        const headY = r.y - BODY_H;
        if (Math.abs(player.x - r.x) < BODY_W && prevY <= headY + STOMP_TOLERANCE && player.y >= headY) {
          player.y = headY;
          player.vy = -BOUNCE_SPEED;
          player.coyote = 0;
          break;
        }
      }
    }

    if (player.y >= GROUND_Y) { player.y = GROUND_Y; player.vy = 0; player.onGround = true; }
    else player.onGround = false;

    player.x = Math.max(player.w / 2 + EDGE, Math.min(WORLD_W - player.w / 2 - EDGE, player.x));
    player.animTime += dt;

    const targetX = player.x - W * 0.5;
    camera.x += (targetX - camera.x) * Math.min(1, dt * 8);
    camera.x = Math.max(0, Math.min(WORLD_W - W, camera.x));

    // jogadores remotos: interpola até a última posição recebida
    for (const r of remote.values()) {
      r.x += (r.tx - r.x) * Math.min(1, dt * 14);
      r.y += (r.ty - r.y) * Math.min(1, dt * 14);
    }

    // publica o próprio estado só quando muda (a plataforma coalesce a ~30/s)
    if (onState) {
      const a = !player.onGround ? 'j' : player.vx !== 0 ? 'w' : 'i';
      const state = { x: Math.round(player.x), y: Math.round(player.y), f: player.facing, a };
      const key = `${state.x},${state.y},${state.f},${state.a}`;
      if (key !== lastSent) { lastSent = key; onState(state); }
    }
  }

  // ---------- Render ----------
  function drawParallax() {
    ctx.fillStyle = skyColor;
    ctx.fillRect(0, 0, W, H);
    for (const layer of PARALLAX) {
      const { pattern, width, height } = bg[layer.key];
      const dy = GROUND_Y - height + 6 + layer.offsetY;
      const off = -Math.round((camera.x * layer.factor) % width);
      ctx.save();
      ctx.translate(off, dy);
      ctx.fillStyle = pattern;
      ctx.fillRect(-off, 0, W, height);
      ctx.restore();
    }
  }

  function drawGround() {
    const startCol = Math.max(0, Math.floor(camera.x / TILE) - 1);
    const endCol = Math.min(WORLD_COLS - 1, Math.ceil((camera.x + W) / TILE) + 1);
    for (let col = startCol; col <= endCol; col++) {
      const sx = Math.round(col * TILE - camera.x);
      for (let row = 0; row < GROUND_ROWS; row++) {
        ctx.drawImage(row === 0 ? img.groundTop : img.groundMid, sx, GROUND_Y + row * TILE, TILE, TILE);
      }
    }
  }

  function spriteFor(color, anim, t) {
    const set = chars[color] || chars.green;
    if (anim === 'j') return set.jump;
    if (anim === 'w') return Math.floor(t * 8) % 2 ? set.walkA : set.walkB;
    return set.idle;
  }

  function drawCharacter(x, y, facing, sprite, nick, dim) {
    const sx = Math.round(x - camera.x), sy = Math.round(y);
    if (sx < -200 || sx > W + 200) return;
    ctx.save();
    if (dim) ctx.globalAlpha = 0.9;
    ctx.translate(sx, sy);
    if (facing < 0) ctx.scale(-1, 1);
    ctx.drawImage(sprite, -sprite.width / 2, -sprite.height, sprite.width, sprite.height);
    ctx.restore();
    if (nick) {
      ctx.save();
      ctx.font = '600 14px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(20,40,60,.55)'; ctx.fillStyle = '#fff';
      ctx.strokeText(nick, sx, sy - sprite.height - 8);
      ctx.fillText(nick, sx, sy - sprite.height - 8);
      ctx.restore();
    }
  }

  function render() {
    drawParallax();
    drawGround();
    const t = performance.now() / 1000;
    for (const r of remote.values()) drawCharacter(r.x, r.y, r.f, spriteFor(r.color, r.a, t), r.nick, true);
    const anim = !player.onGround ? 'j' : player.vx !== 0 ? 'w' : 'i';
    drawCharacter(player.x, player.y, player.facing, spriteFor(player.color, anim, player.animTime), player.nick, false);
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    raf = requestAnimationFrame(frame);
  }

  // ---------- API ----------
  function load(targetCanvas) {
    canvas = targetCanvas;
    ctx = canvas.getContext('2d');
    if (loaded) return loaded;
    loaded = (async () => {
      const entries = await Promise.all(Object.entries(ASSETS).map(async ([k, src]) => [k, await loadImage(src)]));
      img = Object.fromEntries(entries);
      for (const color of COLORS) {
        const set = await Promise.all(Object.entries(CHAR_ASSETS[color]).map(async ([k, src]) => [k, await loadImage(src)]));
        chars[color] = Object.fromEntries(set);
      }
      for (const layer of PARALLAX) {
        const keyed = keyOutTopColor(img[layer.src], layer.pixel);
        bg[layer.key] = makeLayer(ctx, keyed, layer.scale);
        if (layer.key === 'clouds') skyColor = keyed.keyColor;
      }
    })();
    return loaded;
  }

  // spawnX: posição sugerida (ex.: perto de outro jogador); sem ela, nasce no meio do mapa
  function start({ color, nick, spawnX, onState: cb }) {
    const x = Number.isFinite(spawnX) ? spawnX : WORLD_W / 2 + (Math.random() - 0.5) * 160;
    Object.assign(player, { x, y: GROUND_Y, vx: 0, vy: 0, facing: 1, onGround: true, color: COLORS.includes(color) ? color : 'green', nick: nick || '' });
    camera.x = Math.max(0, Math.min(WORLD_W - W, player.x - W * 0.5));
    remote.clear();
    onState = cb || null;
    lastSent = '';
    keys.clear();
    Object.assign(virt, { left: false, right: false, jump: false });
    addEventListener('keydown', onKeyDown);
    addEventListener('keyup', onKeyUp);
    addEventListener('blur', onBlur);
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKeyDown);
    removeEventListener('keyup', onKeyUp);
    removeEventListener('blur', onBlur);
    onState = null;
  }

  // Substitui o conjunto de jogadores remotos: [{ peer, x, y, f, a, color, nick }]
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

  return { load, start, stop, setRemote, setVirtualInput, COLORS, W, H, WORLD_W, GROUND_Y };
})();
