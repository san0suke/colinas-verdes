// Gerador procedural da arena (modo combate, visão de cima), compartilhado entre navegador e servidor.
// Grade de 16 px (desenhada em 4×). Mesma semente → mesma arena em todos os clientes e no servidor.
//   ground[r][c]: 'g' grama, 'd' terra, 'w' água (bloqueia)
//   blocked[r][c]: 1 = não anda
//   objects: { kind: 'tree'|'bush'|'rock'|'tuft'|'flower', idx, tx, ty, tw, th }  (posição/tamanho em tiles; idx = qual sprite da categoria)
//   spawns: pontos livres e afastados entre si (em px)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArenaLevel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TILE = 16, COLS = 26, ROWS = 16;
  // quantidade de sprites por categoria (assets/retro/index.json) — o cliente/servidor só precisam do índice
  const COUNTS = { tree: 20, bush: 29, rock: 22, tuft: 18, flower: 59 };

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

  function build(seed, counts) {
    const rnd = mulberry32(seed);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const chance = (p) => rnd() < p;
    const ground = Array.from({ length: ROWS }, () => Array(COLS).fill('g'));
    const blocked = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    const objects = [];
    const inside = (r, c) => r >= 1 && c >= 1 && r < ROWS - 1 && c < COLS - 1;
    const free = (r, c, tw, th) => { for (let y = r; y < r + th; y++) for (let x = c; x < c + tw; x++) { if (!inside(y, x) || blocked[y][x] || ground[y][x] !== 'g' || objects.some((o) => x >= o.tx && x < o.tx + o.tw && y >= o.ty && y < o.ty + o.th)) return false; } return true; };
    const place = (kind, tw, th, r, c, block) => { objects.push({ kind, idx: Math.floor(rnd() * counts[kind]), tx: c, ty: r, tw, th }); if (block) for (let y = r; y < r + th; y++) for (let x = c; x < c + tw; x++) blocked[y][x] = 1; };

    // borda: árvores em volta (bloqueadas), a cada 2 tiles, com variação de altura
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!inside(r, c)) blocked[r][c] = 1;
    for (let c = 0; c < COLS; c += 2) { objects.push({ kind: 'tree', idx: Math.floor(rnd() * counts.tree), tx: c, ty: -1, tw: 2, th: 2, border: true }); objects.push({ kind: 'tree', idx: Math.floor(rnd() * counts.tree), tx: c, ty: ROWS - 1, tw: 2, th: 2, border: true }); }
    for (let r = 1; r < ROWS - 1; r += 2) { objects.push({ kind: 'tree', idx: Math.floor(rnd() * counts.tree), tx: -1, ty: r, tw: 2, th: 2, border: true }); objects.push({ kind: 'tree', idx: Math.floor(rnd() * counts.tree), tx: COLS - 1, ty: r, tw: 2, th: 2, border: true }); }

    // lagos: 1-3 manchas de água por caminhada aleatória
    const lakes = ri(1, 3);
    for (let i = 0; i < lakes; i++) {
      let r = ri(3, ROWS - 4), c = ri(3, COLS - 4);
      const n = ri(5, 12);
      for (let k = 0; k < n; k++) {
        if (inside(r, c) && r > 1 && c > 1 && r < ROWS - 2 && c < COLS - 2) { ground[r][c] = 'w'; blocked[r][c] = 1; }
        r += ri(-1, 1); c += ri(-1, 1);
      }
    }
    // trilhas de terra (decoração)
    const paths = ri(1, 3);
    for (let i = 0; i < paths; i++) {
      let r = ri(2, ROWS - 3), c = ri(2, COLS - 3);
      for (let k = ri(6, 14); k > 0; k--) { if (inside(r, c) && ground[r][c] === 'g') ground[r][c] = 'd'; if (chance(0.5)) c += ri(-1, 1); else r += ri(-1, 1); }
    }
    // obstáculos: árvores (2×2), arbustos (2×1), pedras (1×1)
    for (let i = 0, tries = 0; i < ri(3, 6) && tries < 200; tries++) { const r = ri(2, ROWS - 4), c = ri(2, COLS - 4); if (free(r, c, 2, 2)) { place('tree', 2, 2, r, c, true); i++; } }
    for (let i = 0, tries = 0; i < ri(4, 8) && tries < 200; tries++) { const r = ri(2, ROWS - 3), c = ri(2, COLS - 3); if (free(r, c, 2, 1)) { place('bush', 2, 1, r, c, true); i++; } }
    for (let i = 0, tries = 0; i < ri(6, 12) && tries < 200; tries++) { const r = ri(2, ROWS - 3), c = ri(2, COLS - 3); if (free(r, c, 1, 1)) { place('rock', 1, 1, r, c, true); i++; } }
    // decoração (não bloqueia)
    for (let i = 0; i < 40; i++) { const r = ri(1, ROWS - 2), c = ri(1, COLS - 2); if (ground[r][c] === 'g' && !blocked[r][c]) objects.push({ kind: chance(0.7) ? 'tuft' : 'flower', idx: Math.floor(rnd() * counts[chance(0.7) ? 'tuft' : 'flower']), tx: c, ty: r, tw: 1, th: 1, deco: true }); }
    for (const o of objects) if (o.deco) o.idx = Math.floor(rnd() * counts[o.kind]); // garante idx válido para a categoria

    // região livre principal (flood fill) e pontos de nascimento afastados
    const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    let best = [];
    for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
      if (seen[r][c] || blocked[r][c]) continue;
      const region = []; const stack = [[r, c]]; seen[r][c] = 1;
      while (stack.length) { const [y, x] = stack.pop(); region.push([y, x]); for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ny = y + dy, nx = x + dx; if (inside(ny, nx) && !seen[ny][nx] && !blocked[ny][nx]) { seen[ny][nx] = 1; stack.push([ny, nx]); } } }
      if (region.length > best.length) best = region;
    }
    const interior = (ROWS - 2) * (COLS - 2);
    if (best.length < interior * 0.6) return null; // muito recortada: tenta outra semente
    // ilhas isoladas viram bloqueio (o jogador nunca nasce nelas)
    for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) if (!blocked[r][c] && !best.some(([y, x]) => y === r && x === c)) blocked[r][c] = 1;
    const spawns = [];
    const shuffled = best.slice().sort(() => rnd() - 0.5);
    for (const [r, c] of shuffled) {
      const x = c * TILE + TILE / 2, y = r * TILE + TILE / 2;
      if (spawns.every((s) => Math.hypot(s.x - x, s.y - y) >= 5 * TILE)) spawns.push({ x, y });
      if (spawns.length >= 12) break;
    }
    if (spawns.length < 4) return null;
    return { seed, tile: TILE, cols: COLS, rows: ROWS, width: COLS * TILE, height: ROWS * TILE, ground, blocked, objects, spawns };
  }

  function generate(seed, counts) {
    counts = counts || COUNTS;
    for (let k = 0; k < 20; k++) { const l = build((seed + k * 7919) >>> 0, counts); if (l) return l; }
    return build(seed >>> 0, counts) || build(1, counts);
  }
  return { generate, TILE, COLS, ROWS, COUNTS };
});
