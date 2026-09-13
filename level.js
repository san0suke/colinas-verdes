// Gerador procedural de fases (compartilhado entre navegador e servidor).
// Uma semente sempre produz a mesma fase, então cliente e servidor concordam
// sobre largura, posição da chegada e posição/movimento dos inimigos.
//
// Grade: TILE = 64 px, ROWS linhas (0 = topo). O chão padrão ocupa as linhas 7 e 8.
// Cada célula é null ou { s: nome do sprite no spritesheet de tiles, k: tipo }:
//   solid  – bloqueia em todas as direções
//   oneway – plataforma: só bloqueia caindo por cima
//   hazard – machuca ao encostar (água, lava, espinhos)
//   coin / gem – colecionável (some ao pegar)
//   spring – mola: impulso forte ao pisar
//   deco   – só visual
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Level = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TILE = 64;
  const ROWS = 9;
  const GROUND = 7;              // linha do topo do chão padrão
  const THEMES = ['grass', 'sand', 'snow', 'stone', 'purple', 'dirt'];
  const BG_FOR = { grass: 'hills', dirt: 'trees', sand: 'desert', purple: 'mushrooms', snow: 'hills', stone: 'trees' };
  const LIQUID_FOR = { grass: 'water', sand: 'water', snow: 'water', dirt: 'water', stone: 'lava', purple: 'lava' };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generate(seed) {
    const rnd = mulberry32(seed);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));   // inteiro em [a, b]
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const chance = (p) => rnd() < p;

    const theme = pick(THEMES);
    const liquid = LIQUID_FOR[theme];
    const targetCols = ri(150, 190);
    const cells = [];                       // cells[row][col]
    const entities = [];                    // inimigos e objetos móveis
    const checkpoints = [];                 // x (px) de pontos seguros para renascer
    const T = (name) => `terrain_${theme}_${name}`;

    const get = (r, c) => (cells[r] && cells[r][c]) || null;
    const set = (r, c, s, k) => { if (r < 0 || r >= ROWS || c < 0) return; (cells[r] || (cells[r] = []))[c] = { s, k }; };
    const isTerrain = (r, c) => { const x = get(r, c); return !!(x && x.k === 'solid' && x.s.startsWith('terrain_') && !x.s.includes('horizontal') && !x.s.includes('cloud')); };

    // chão sólido nas colunas [c0, c1] com topo na linha gt
    function ground(c0, c1, gt) {
      for (let c = c0; c <= c1; c++) for (let r = gt; r < ROWS; r++) set(r, c, T('block_center'), 'solid');
    }
    function liquidPit(c0, c1) {
      for (let c = c0; c <= c1; c++) { set(GROUND, c, `${liquid}_top`, 'hazard'); set(GROUND + 1, c, liquid, 'hazard'); }
    }
    function platform(c0, c1, r, cloud) {
      const w = c1 - c0;
      for (let c = c0; c <= c1; c++) {
        const part = w === 0 ? 'middle' : c === c0 ? 'left' : c === c1 ? 'right' : 'middle';
        set(r, c, cloud ? T(`cloud_${part}`) : T(`horizontal_${part}`), 'oneway');
      }
    }
    function coinsRow(c0, c1, r, kind) {
      for (let c = c0; c <= c1; c++) if (!get(r, c)) set(r, c, kind || 'coin_gold', 'coin');
    }
    function coinArc(c0, c1, r) { // arco: pontas baixas, meio alto
      const mid = (c0 + c1) / 2;
      for (let c = c0; c <= c1; c++) { const up = Math.abs(c - mid) < 1 ? 1 : 0; if (!get(r - up, c)) set(r - up, c, 'coin_gold', 'coin'); }
    }
    function deco(r, c, s) { if (!get(r, c)) set(r, c, s, 'deco'); }
    const decoSet = {
      grass: ['bush', 'rock', 'mushroom_brown', 'mushroom_red', 'grass', 'fence', 'fence_broken', 'sign', 'hill'],
      dirt: ['bush', 'rock', 'mushroom_brown', 'grass', 'fence', 'fence_broken', 'sign', 'weight'],
      sand: ['cactus', 'rock', 'sign', 'fence_broken', 'bush', 'grass'],
      snow: ['rock', 'snow', 'fence', 'sign', 'bush'],
      stone: ['rock', 'torch_on_a', 'window', 'lever', 'chain', 'weight'],
      purple: ['grass_purple', 'mushroom_red', 'mushroom_brown', 'torch_on_a', 'rock'],
    };
    function sprinkleDeco(c0, c1, gt, density) {
      for (let c = c0; c <= c1; c++) if (chance(density)) {
        const s = pick(decoSet[theme]);
        if (s === 'hill') { deco(gt - 1, c, 'hill'); deco(gt - 2, c, chance(0.5) ? 'hill_top_smile' : 'hill_top'); }
        else deco(gt - 1, c, s);
      }
    }
    const walkers = ['slime_normal', 'slime_block', 'ladybug', 'mouse', 'snail', 'worm_normal', 'worm_ring', 'frog'];
    const hurtOnStomp = new Set(['slime_spike', 'slime_fire', 'saw', 'barnacle']);
    function walker(c0, c1, gt, kind) {
      entities.push({ type: kind || pick(walkers), kind: 'walker', x0: c0 * TILE + 32, x1: c1 * TILE + 32, y: gt * TILE, speed: 60 + ri(0, 60) + Math.round(difficulty * 60), phase: rnd() * 10 });
    }
    function flyer(c0, c1, r, kind) {
      entities.push({ type: kind || pick(['bee', 'fly']), kind: 'flyer', x0: c0 * TILE + 32, x1: c1 * TILE + 32, y: r * TILE + 32, amp: 24 + ri(0, 40), speed: 70 + ri(0, 70), phase: rnd() * 10 });
    }

    // ---------- trechos ----------
    let x = 0;           // próxima coluna livre
    let gt = GROUND;     // topo do chão atual
    let difficulty = 0;  // 0 → 1 ao longo da fase

    function chunkStart() {
      ground(x, x + 6, GROUND);
      deco(GROUND - 1, x + 1, 'flag_green_a');
      deco(GROUND - 1, x + 2, 'sign_right');
      checkpoints.push((x + 1) * TILE + 32);
      x += 7;
    }
    function chunkFinish() {
      ground(x, x + 7, gt);
      const finishCol = x + 3;
      deco(gt - 1, finishCol, 'flag_red_a');
      deco(gt - 1, x + 5, 'door_open'); deco(gt - 2, x + 5, 'door_open_top');
      deco(gt - 1, x + 6, 'sign_exit');
      x += 8;
      return finishCol * TILE + 32;
    }
    function chunkFlat() {
      const w = ri(3, 7);
      ground(x, x + w - 1, gt);
      checkpoints.push(x * TILE + 32);
      if (w >= 5 && chance(0.25 + difficulty * 0.5)) walker(x + 1, x + w - 2, gt);
      else sprinkleDeco(x, x + w - 1, gt, 0.35);
      if (chance(0.5)) coinArc(x + 1, x + w - 2, gt - 2);
      x += w;
    }
    function chunkGap() {
      const w = difficulty > 0.3 && chance(0.5) ? 3 : 2;
      liquidPit(x, x + w - 1);
      if (chance(0.4)) coinsRow(x, x + w - 1, gt - 2);
      if (liquid === 'water' && difficulty > 0.45 && chance(0.5)) entities.push({ type: pick(['fish_blue', 'fish_yellow']), kind: 'fish', x: (x + w / 2) * TILE, y: (GROUND + 1) * TILE, speed: 1 + rnd(), phase: rnd() * 10 });
      x += w;
    }
    function chunkStep(dir) {
      const dh = dir > 0 && difficulty > 0.5 && chance(0.35) ? 2 : (dir < 0 && chance(0.5) ? 2 : 1); // subir 2 só no fim; descer 2 é fácil
      const ngt = Math.max(3, Math.min(GROUND, gt - dir * dh));
      if (ngt === gt) return chunkFlat();
      gt = ngt;
      const w = ri(3, 5);
      ground(x, x + w - 1, gt);
      checkpoints.push(x * TILE + 32);
      sprinkleDeco(x, x + w - 1, gt, 0.25);
      x += w;
    }
    function chunkPlatforms() {
      const w = ri(4, 7);
      liquidPit(x, x + w - 1);
      const cloud = chance(0.5);
      let c = x;
      let r = gt - 1;
      while (c <= x + w - 2) {
        const pw = ri(1, 2);
        const end = Math.min(c + pw, x + w - 1);
        platform(c, end, r, cloud);
        if (chance(0.7)) coinsRow(c, end, r - 1);
        c = end + (difficulty > 0.4 && chance(0.5) ? 3 : 2);
        r = gt - (chance(0.5) ? 1 : 2);
      }
      x += w;
    }
    function chunkSpikes() {
      const w = ri(5, 7);
      ground(x, x + w - 1, gt);
      checkpoints.push(x * TILE + 32);
      const n = difficulty > 0.5 && chance(0.5) ? 2 : 1;
      const s = x + ri(2, w - 1 - n);
      for (let c = s; c < s + n; c++) set(gt - 1, c, 'spikes', 'hazard');
      if (chance(0.5)) coinsRow(s, s + n - 1, gt - 3);
      x += w;
    }
    function chunkWall() {
      const w = ri(5, 7);
      ground(x, x + w - 1, gt);
      checkpoints.push(x * TILE + 32);
      const c = x + ri(2, w - 3);
      const block = pick(['block_blue', 'block_green', 'block_red', 'block_yellow', 'brick_brown', 'brick_grey', 'block_planks']);
      set(gt - 1, c, block, 'solid');
      if (chance(0.5)) set(gt - 2, c, 'coin_gold', 'coin');
      if (chance(0.4)) deco(gt - 1, c + 1, pick(['bomb', 'key_yellow', 'star']));
      x += w;
    }
    function chunkBlocks() { // fileira de blocos flutuantes com moedas em cima
      const w = ri(5, 8);
      ground(x, x + w - 1, gt);
      checkpoints.push(x * TILE + 32);
      const n = ri(2, Math.min(4, w - 2));
      const c0 = x + ri(1, w - n - 1);
      for (let c = c0; c < c0 + n; c++) {
        set(gt - 2, c, pick(['block_coin', 'block_exclamation', 'brick_brown', 'bricks_grey', 'block_empty']), 'solid');
        if (chance(0.7)) set(gt - 3, c, chance(0.2) ? pick(['gem_blue', 'gem_green', 'gem_red', 'gem_yellow']) : 'coin_gold', 'coin');
      }
      if (chance(0.4)) walker(x + 1, x + w - 2, gt);
      x += w;
    }
    function chunkSpring() {
      const w = ri(7, 9);
      ground(x, x + w - 1, gt);
      checkpoints.push(x * TILE + 32);
      set(gt - 1, x + 2, 'spring', 'spring');
      const hi = Math.max(1, gt - 5);
      platform(x + 3, x + 5, hi, true);
      coinsRow(x + 3, x + 5, hi - 1, pick(['gem_blue', 'gem_green', 'gem_red', 'gem_yellow']));
      if (difficulty > 0.35) { for (let r = gt - 1; r >= gt - 3; r--) set(r, x + 4, 'bricks_brown', 'solid'); } // muro alto: só passa com a mola
      x += w;
    }
    function chunkBridge() {
      const w = ri(3, 6);
      liquidPit(x, x + w - 1);
      const kind = pick(['bridge', 'bridge_logs']);
      for (let c = x; c <= x + w - 1; c++) set(gt - 1, c, kind, 'oneway');
      if (chance(0.5)) coinsRow(x, x + w - 1, gt - 3);
      if (difficulty > 0.5 && chance(0.5)) flyer(x, x + w - 1, gt - 3);
      x += w;
    }
    function chunkSaw() {
      const w = ri(5, 7);
      ground(x, x + w - 1, gt);
      checkpoints.push(x * TILE + 32);
      entities.push({ type: 'saw', kind: 'walker', x0: (x + 1) * TILE + 32, x1: (x + w - 2) * TILE + 32, y: gt * TILE, speed: 100 + Math.round(difficulty * 80), phase: rnd() * 10 });
      coinsRow(x + 1, x + w - 2, gt - 3);
      x += w;
    }
    function chunkFlyerGap() {
      const w = 3;
      liquidPit(x, x + w - 1);
      flyer(x, x + w - 1, gt - 2);
      x += w;
    }
    function chunkSpikeSlime() {
      const w = ri(5, 7);
      ground(x, x + w - 1, gt);
      checkpoints.push(x * TILE + 32);
      walker(x + 1, x + w - 2, gt, pick(['slime_spike', 'slime_fire']));
      platform(x + 1, x + w - 2, gt - 3, false);
      coinsRow(x + 1, x + w - 2, gt - 4);
      x += w;
    }

    // ---------- montagem ----------
    chunkStart();
    let lastKind = '';
    while (x < targetCols) {
      difficulty = Math.min(1, x / targetCols);
      const options = [
        ['flat', 3], ['gap', 2], ['stepUp', 1.5], ['stepDown', 1.5], ['platforms', 2], ['spikes', 1.5],
        ['wall', 1.5], ['blocks', 1.5], ['spring', 1], ['bridge', 1.5], ['saw', difficulty > 0.3 ? 1 : 0],
        ['flyerGap', difficulty > 0.4 ? 1 : 0], ['spikeSlime', difficulty > 0.5 ? 1 : 0],
      ].filter(([k, w]) => w > 0 && k !== lastKind);
      // dois trechos "de risco" seguidos (buraco/plataformas/voador) não; sempre volta a ter chão
      const risky = new Set(['gap', 'platforms', 'bridge', 'flyerGap']);
      const pool = risky.has(lastKind) ? options.filter(([k]) => !risky.has(k)) : options;
      const total = pool.reduce((s, [, w]) => s + w, 0);
      let pickAt = rnd() * total, kind = pool[0][0];
      for (const [k, w] of pool) { pickAt -= w; if (pickAt <= 0) { kind = k; break; } }
      lastKind = kind;
      ({ flat: chunkFlat, gap: chunkGap, stepUp: () => chunkStep(1), stepDown: () => chunkStep(-1), platforms: chunkPlatforms,
        spikes: chunkSpikes, wall: chunkWall, blocks: chunkBlocks, spring: chunkSpring, bridge: chunkBridge, saw: chunkSaw,
        flyerGap: chunkFlyerGap, spikeSlime: chunkSpikeSlime })[kind]();
    }
    // descida suave até o nível padrão antes da chegada
    while (gt < GROUND) { gt++; ground(x, x + 2, gt); x += 3; }
    const finishX = chunkFinish();
    const cols = x;

    // ---------- autotile do terreno ----------
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < cols; c++) {
      if (!isTerrain(r, c)) continue;
      const up = isTerrain(r - 1, c), left = isTerrain(r, c - 1), right = isTerrain(r, c + 1);
      let name;
      if (!up) name = !left && !right ? 'block' : !left ? 'block_top_left' : !right ? 'block_top_right' : 'block_top';
      else name = !left && !right ? 'vertical_middle' : !left ? 'block_left' : !right ? 'block_right' : 'block_center';
      cells[r][c] = { s: T(name), k: 'solid' };
    }

    return {
      seed, theme, bg: BG_FOR[theme], liquid, cols, rows: ROWS, width: cols * TILE, height: ROWS * TILE,
      cells, entities, checkpoints, spawnX: TILE + 32, spawnY: GROUND * TILE, finishX, hurtOnStomp: [...hurtOnStomp],
    };
  }

  return { generate, TILE, ROWS, GROUND };
});
