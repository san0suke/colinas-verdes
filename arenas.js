// Arenas fixas do modo combate (5 ambientes), compartilhado entre navegador e servidor.
// Cada arena: chão em ASCII (1 char = 1 tile de 16 px, desenhado em 4×) e objetos posicionados por tile.
//   chão: g grama · d terra · s areia · n neve · p piso de pedra · w água (bloqueia) · l lava (bloqueia) · k escuro (fora, bloqueia)
//         W parede de masmorra (bloqueia; desenhada com o anel de pedra por vizinhança)
//   objetos: { k: chave, tx, ty } com a chave definida em `keys`: { set, idx } ou { rect:[x,y,w,h] } no atlas,
//            tw/th = ocupação em tiles a partir de (tx,ty), block = bloqueia; a base do sprite fica na linha ty+th-1.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Arenas = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TILE = 16;
  const rows = (s) => s.trim().split('\n').map((l) => l.replace(/\s+$/, ''));

  // ---------- chaves de objetos (rect no atlas) ----------
  const K = {
    // vila
    houseA: { rect: [1296, 16, 64, 48], tw: 4, th: 3, block: true },
    houseB: { rect: [1360, 16, 80, 48], tw: 5, th: 3, block: true },
    houseC: { rect: [1440, 16, 80, 48], tw: 5, th: 3, block: true },
    cabin:  { set: 'houses', idx: 6, tw: 4, th: 3, block: true },
    inn:    { set: 'houses', idx: 7, tw: 5, th: 3, block: true },
    stallG: { set: 'houses', idx: 2, tw: 3, th: 2, block: true },
    stallO: { set: 'houses', idx: 3, tw: 3, th: 2, block: true },
    stallC: { set: 'houses', idx: 4, tw: 3, th: 2, block: true },
    well:   { rect: [784, 752, 48, 80], tw: 3, th: 2, block: true },
    barrels:{ set: 'dungeon', idx: 61, tw: 3, th: 1, block: true },
    barrel: { set: 'dungeon', idx: 44, tw: 1, th: 1, block: true },
    crates: { set: 'dungeon', idx: 67, tw: 3, th: 2, block: true },
    crate:  { set: 'dungeon', idx: 68, tw: 1, th: 1, block: true },
    lamp:   { set: 'dungeon', idx: 39, tw: 1, th: 2, block: true },
    lamp2:  { set: 'dungeon', idx: 46, tw: 1, th: 2, block: true },
    fence3: { set: 'dungeon', idx: 78, tw: 3, th: 1, block: true },
    post:   { set: 'fences', idx: 12, tw: 1, th: 1, block: true },
    sign:   { set: 'dungeon', idx: 60, tw: 3, th: 1, block: true },
    chest:  { set: 'dungeon', idx: 72, tw: 1, th: 1, block: true },
    // floresta
    treeG:  { set: 'obj', kind: 'tree', idx: 0, tw: 2, th: 2, block: true },
    treeG2: { set: 'obj', kind: 'tree', idx: 1, tw: 2, th: 2, block: true },
    treeG3: { set: 'obj', kind: 'tree', idx: 11, tw: 2, th: 2, block: true },
    pines:  { set: 'obj', kind: 'tree', idx: 2, tw: 3, th: 2, block: true },
    grove:  { set: 'overworld', idx: 2, tw: 3, th: 3, block: true },
    bushG:  { set: 'obj', kind: 'bush', idx: 9, tw: 2, th: 1, block: true },
    bushG2: { set: 'obj', kind: 'bush', idx: 20, tw: 2, th: 1, block: true },
    bushG3: { set: 'obj', kind: 'bush', idx: 16, tw: 1, th: 1, block: true },
    logs:   { set: 'obj', kind: 'bush', idx: 2, tw: 2, th: 1, block: true },
    log:    { set: 'obj', kind: 'bush', idx: 4, tw: 3, th: 1, block: true },
    rockM:  { set: 'obj', kind: 'rock', idx: 13, tw: 2, th: 1, block: true },
    rockM2: { set: 'obj', kind: 'rock', idx: 15, tw: 2, th: 2, block: true },
    rockG:  { set: 'obj', kind: 'rock', idx: 9, tw: 1, th: 1, block: true },
    rockG2: { set: 'obj', kind: 'rock', idx: 6, tw: 2, th: 1, block: true },
    tuft:   { set: 'obj', kind: 'tuft', idx: 2, tw: 1, th: 1, deco: true },
    tuft2:  { set: 'obj', kind: 'tuft', idx: 9, tw: 1, th: 1, deco: true },
    flower: { set: 'obj', kind: 'flower', idx: 7, tw: 1, th: 1, deco: true },
    // deserto
    cactus: { set: 'obj', kind: 'bush', idx: 5, tw: 1, th: 2, block: true },
    cactus2:{ set: 'obj', kind: 'bush', idx: 6, tw: 1, th: 2, block: true },
    cactus3:{ set: 'obj', kind: 'bush', idx: 8, tw: 1, th: 2, block: true },
    palm:   { set: 'obj', kind: 'tree', idx: 14, tw: 2, th: 2, block: true },
    palm2:  { set: 'obj', kind: 'tree', idx: 18, tw: 2, th: 2, block: true },
    rockD:  { set: 'obj', kind: 'rock', idx: 2, tw: 1, th: 2, block: true },
    rockD2: { set: 'obj', kind: 'rock', idx: 4, tw: 2, th: 1, block: true },
    rockD3: { set: 'obj', kind: 'rock', idx: 0, tw: 2, th: 1, block: true },
    mesa:   { set: 'cliffs', idx: 1, tw: 3, th: 3, block: true },
    mesaS:  { set: 'cliffs', idx: 0, tw: 3, th: 3, block: true },
    pebbles:{ set: 'obj', kind: 'rock', idx: 20, tw: 1, th: 1, deco: true },
    // inverno
    treeB:  { set: 'obj', kind: 'tree', idx: 3, tw: 2, th: 2, block: true },
    treeB2: { set: 'obj', kind: 'tree', idx: 4, tw: 2, th: 2, block: true },
    treeB3: { set: 'obj', kind: 'tree', idx: 5, tw: 3, th: 2, block: true },
    bushB:  { set: 'obj', kind: 'bush', idx: 18, tw: 2, th: 1, block: true },
    rockI:  { set: 'obj', kind: 'rock', idx: 10, tw: 1, th: 1, block: true },
    rockI2: { set: 'obj', kind: 'rock', idx: 8, tw: 2, th: 1, block: true },
    iceWall:{ set: 'cliffs', idx: 10, tw: 3, th: 3, block: true },
    iceHill:{ set: 'cliffs', idx: 11, tw: 2, th: 2, block: true },
    tuftB:  { set: 'obj', kind: 'tuft', idx: 1, tw: 1, th: 1, deco: true },
    bushB2: { set: 'obj', kind: 'bush', idx: 13, tw: 1, th: 1, block: true },
    // masmorra
    statueA:{ set: 'dungeon', idx: 30, tw: 1, th: 2, block: true },
    statueB:{ set: 'dungeon', idx: 31, tw: 1, th: 2, block: true },
    demon:  { set: 'dungeon', idx: 74, tw: 2, th: 2, block: true },
    gargoyle:{ set: 'dungeon', idx: 83, tw: 2, th: 2, block: true },
    pillar: { set: 'dungeon', idx: 76, tw: 2, th: 2, block: true },
    altar:  { set: 'dungeon', idx: 53, tw: 2, th: 2, block: true },
    pot:    { set: 'dungeon', idx: 0, tw: 1, th: 1, block: true },
    pot2:   { set: 'dungeon', idx: 5, tw: 1, th: 1, block: true },
    skull:  { set: 'dungeon', idx: 1, tw: 1, th: 1, deco: true },
    bones:  { set: 'dungeon', idx: 27, tw: 2, th: 1, deco: true },
    banner: { set: 'dungeon', idx: 87, tw: 1, th: 2, deco: true },
    banner2:{ set: 'dungeon', idx: 88, tw: 1, th: 2, deco: true },
    lantern:{ set: 'dungeon', idx: 104, tw: 1, th: 1, deco: true },
    grate:  { set: 'dungeon', idx: 63, tw: 3, th: 3, deco: true },
    plates: { set: 'dungeon', idx: 65, tw: 3, th: 1, deco: true },
    torii:  { set: 'dungeon', idx: 64, tw: 3, th: 2, block: true },
    torch:  { set: 'dungeon', idx: 39, tw: 1, th: 2, block: true },
  };

  // ---------- as 5 arenas (26×16) ----------
  const ARENAS = [
    {
      name: 'Vila', theme: 'village',
      ground: rows(`
gggggggggggggggggggggggggg
gggggggggggggggggggggggggg
ggggggggddddddddddddgggggg
ggggggggdggggggggggdgggggg
ggggggggdggggggggggdgggggg
ggdddddddggggggggggddddggg
ggdgggggdggggggggggggggggg
ggdgggggdggggwwgggggggdggg
ggdgggggdggggwwgggggggdggg
ggdgggggddddddddddddddddgg
ggdgggggggggggggggggggdggg
ggddddddgggggggggggggddggg
gggggggdgggggggggggggdgggg
gggggggddddddddddddddggggg
gggggggggggggggggggggggggg
gggggggggggggggggggggggggg`),
      objects: [
        { k: 'houseA', tx: 3, ty: 1 }, { k: 'houseB', tx: 10, ty: 0 }, { k: 'cabin', tx: 18, ty: 1 }, { k: 'inn', tx: 3, ty: 13 }, { k: 'houseA', tx: 19, ty: 13 },
        { k: 'stallG', tx: 10, ty: 12 }, { k: 'stallO', tx: 14, ty: 12 },
        { k: 'well', tx: 15, ty: 6 },
        { k: 'barrels', tx: 3, ty: 7 }, { k: 'crates', tx: 21, ty: 4 }, { k: 'crate', tx: 23, ty: 5 }, { k: 'sign', tx: 8, ty: 6 },
        { k: 'lamp', tx: 9, ty: 9 }, { k: 'lamp2', tx: 18, ty: 9 }, { k: 'lamp', tx: 12, ty: 2 }, { k: 'lamp2', tx: 22, ty: 10 },
        { k: 'fence3', tx: 3, ty: 10 }, { k: 'fence3', tx: 21, ty: 7 }, { k: 'chest', tx: 6, ty: 6 },
        { k: 'treeG', tx: 0, ty: 4 }, { k: 'treeG2', tx: 0, ty: 8 }, { k: 'treeG', tx: 24, ty: 7 }, { k: 'treeG3', tx: 24, ty: 11 }, { k: 'treeG2', tx: 0, ty: 12 },
        { k: 'bushG', tx: 14, ty: 3 }, { k: 'bushG2', tx: 11, ty: 7 }, { k: 'bushG', tx: 24, ty: 3 },
        { k: 'flower', tx: 5, ty: 4 }, { k: 'flower', tx: 16, ty: 4 }, { k: 'tuft', tx: 13, ty: 10 }, { k: 'tuft2', tx: 19, ty: 11 }, { k: 'flower', tx: 2, ty: 14 }, { k: 'tuft', tx: 23, ty: 14 },
      ],
    },
    {
      name: 'Floresta', theme: 'forest',
      ground: rows(`
gggggggggggggggggggggggggg
gggggggggggggggggggggggggg
gggggggggggggggggggggggggg
gggggdggggggggggggggwwwggg
ggggggdgggggggggggggwwwwgg
gggggggdddgggggggggggwwwgg
ggggggggggdgggggggggggwggg
gggggggggggddddgggggggwggg
gggwwggggggggggddggggggggg
ggwwwwgggggggggggddddggggg
ggwwwwgggggggggggggggddggg
gggwwgggggggggggggggggdggg
gggggggggggggggggggggggggg
gggggggggggggggggggggggggg
gggggggggggggggggggggggggg
gggggggggggggggggggggggggg`),
      objects: [
        // borda densa de árvores
        ...Array.from({ length: 13 }, (_, i) => ({ k: i % 3 === 0 ? 'grove' : (i % 3 === 1 ? 'pines' : 'treeG'), tx: i * 2, ty: -1 })),
        ...Array.from({ length: 13 }, (_, i) => ({ k: i % 3 === 1 ? 'grove' : 'treeG2', tx: i * 2, ty: 14 })),
        ...Array.from({ length: 7 }, (_, i) => ({ k: 'treeG3', tx: -1, ty: i * 2 + 1 })),
        ...Array.from({ length: 7 }, (_, i) => ({ k: 'treeG', tx: 25, ty: i * 2 + 1 })),
        // interior
        { k: 'grove', tx: 11, ty: 2 }, { k: 'treeG', tx: 6, ty: 11 }, { k: 'treeG2', tx: 18, ty: 12 }, { k: 'treeG3', tx: 3, ty: 4 }, { k: 'treeG', tx: 15, ty: 9 },
        { k: 'logs', tx: 8, ty: 8 }, { k: 'log', tx: 18, ty: 3 }, { k: 'rockM', tx: 12, ty: 12 }, { k: 'rockM2', tx: 21, ty: 8 }, { k: 'rockG', tx: 5, ty: 7 }, { k: 'rockG', tx: 16, ty: 5 },
        { k: 'bushG', tx: 9, ty: 5 }, { k: 'bushG2', tx: 14, ty: 13 }, { k: 'bushG', tx: 3, ty: 12 }, { k: 'bushG2', tx: 22, ty: 12 },
        { k: 'tuft', tx: 7, ty: 3 }, { k: 'tuft2', tx: 13, ty: 8 }, { k: 'flower', tx: 4, ty: 9 }, { k: 'flower', tx: 17, ty: 2 }, { k: 'tuft', tx: 20, ty: 6 }, { k: 'tuft2', tx: 10, ty: 10 }, { k: 'flower', tx: 23, ty: 4 }, { k: 'tuft', tx: 2, ty: 2 },
      ],
    },
    {
      name: 'Deserto', theme: 'desert',
      ground: rows(`
ssssssssssssssssssssssssss
ssssssssssssssssssssssssss
ssssssssssssssssssssssssss
ssssssssssssssssssssssssss
ssssssssssssssssssssssssss
ssssssssssssssggggssssssss
sssssssssssssgwwwwgsssssss
sssssssssssssgwwwwgsssssss
ssssssssssssssggggssssssss
ssssssssssssssssssssssssss
ssssssssssssssssssssssssss
ssssssssssssssssssssssssss
ssssssssssssssssssssssssss
ssssssssssssssssssssssssss
ssssssssssssssssssssssssss
ssssssssssssssssssssssssss`),
      objects: [
        ...Array.from({ length: 9 }, (_, i) => ({ k: i % 2 ? 'mesa' : 'mesaS', tx: i * 3 - 1, ty: -2 })),
        ...Array.from({ length: 9 }, (_, i) => ({ k: i % 2 ? 'mesaS' : 'mesa', tx: i * 3 - 1, ty: 14 })),
        ...Array.from({ length: 5 }, (_, i) => ({ k: 'mesa', tx: -2, ty: i * 3 + 1 })),
        ...Array.from({ length: 5 }, (_, i) => ({ k: 'mesaS', tx: 25, ty: i * 3 + 1 })),
        { k: 'palm', tx: 12, ty: 4 }, { k: 'palm2', tx: 18, ty: 7 }, { k: 'palm', tx: 4, ty: 3 }, { k: 'palm', tx: 21, ty: 2 },
        { k: 'cactus', tx: 6, ty: 8 }, { k: 'cactus2', tx: 9, ty: 11 }, { k: 'cactus', tx: 20, ty: 11 }, { k: 'cactus2', tx: 3, ty: 11 }, { k: 'cactus', tx: 23, ty: 6 }, { k: 'cactus3', tx: 15, ty: 12 },
        { k: 'rockD', tx: 7, ty: 4 }, { k: 'rockD2', tx: 16, ty: 3 }, { k: 'rockD2', tx: 10, ty: 9 }, { k: 'rockD', tx: 21, ty: 9 }, { k: 'mesa', tx: 4, ty: 6 }, { k: 'mesaS', tx: 18, ty: 9 },
        { k: 'pebbles', tx: 11, ty: 2 }, { k: 'pebbles', tx: 8, ty: 12 }, { k: 'pebbles', tx: 22, ty: 4 }, { k: 'pebbles', tx: 14, ty: 10 }, { k: 'pebbles', tx: 2, ty: 8 },
      ],
    },
    {
      name: 'Neve', theme: 'winter',
      ground: rows(`
nnnnnnnnnnnnnnnnnnnnnnnnnn
nnnnnnnnnnnnnnnnnnnnnnnnnn
nnnnnnnnnnnnnnnnnnnnnnnnnn
nnnnnnnnnnnnnnnnnnnnnnnnnn
nnnnnnnnnnnnnnnnnnnnnnnnnn
nnnnnnnnnnnnnnnnnnnnnnnnnn
nnnnnnnnnnwwwwwwnnnnnnnnnn
nnnnnnnnnnwwwwwwnnnnnnnnnn
nnnnnnnnnnwwwwwwnnnnnnnnnn
nnnnnnnnnnnnnnnnnnnnnnnnnn
nnnnnnnnnnnnnnnnnnnnnnnnnn
nnnnnnnnnnnnnnnnnnnnnnnnnn
nnnnnnnnnnnnnnnnnnnnnnnnnn
nnnnnnnnnnnnnnnnnnnnnnnnnn
nnnnnnnnnnnnnnnnnnnnnnnnnn
nnnnnnnnnnnnnnnnnnnnnnnnnn`),
      objects: [
        ...Array.from({ length: 13 }, (_, i) => ({ k: ['treeB', 'treeB2', 'treeB3'][i % 3], tx: i * 2, ty: -1 })),
        ...Array.from({ length: 13 }, (_, i) => ({ k: ['treeB2', 'treeB3', 'treeB'][i % 3], tx: i * 2, ty: 14 })),
        ...Array.from({ length: 7 }, (_, i) => ({ k: 'treeB', tx: -1, ty: i * 2 + 1 })),
        ...Array.from({ length: 7 }, (_, i) => ({ k: 'treeB3', tx: 25, ty: i * 2 + 1 })),
        { k: 'iceWall', tx: 3, ty: 3 }, { k: 'iceWall', tx: 20, ty: 10 }, { k: 'iceHill', tx: 6, ty: 10 }, { k: 'iceHill', tx: 19, ty: 3 },
        { k: 'treeB2', tx: 12, ty: 2 }, { k: 'treeB', tx: 16, ty: 11 }, { k: 'treeB3', tx: 7, ty: 6 },
        { k: 'rockI', tx: 9, ty: 12 }, { k: 'rockI2', tx: 14, ty: 4 }, { k: 'rockI', tx: 22, ty: 7 }, { k: 'rockI2', tx: 3, ty: 8 },
        { k: 'bushB', tx: 17, ty: 7 }, { k: 'bushB', tx: 5, ty: 12 },
        { k: 'tuftB', tx: 8, ty: 3 }, { k: 'tuftB', tx: 18, ty: 5 }, { k: 'tuftB', tx: 11, ty: 11 }, { k: 'tuftB', tx: 21, ty: 12 }, { k: 'tuftB', tx: 2, ty: 6 },
      ],
    },
    {
      name: 'Masmorra', theme: 'dungeon',
      ground: rows(`
kkkkkkkkkkkkkkkkkkkkkkkkkk
kWWWWWWWWWWWWWWWWWWWWWWWWk
kWppppppppppppppppppppppWk
kWppppppppppppppppppppppWk
kWpppWWWWpppppppppWWWpppWk
kWpppWllWpppppppppWlWpppWk
kWpppWWWWpppppppppWWWpppWk
kWppppppppppppppppppppppWk
kWppppppppppppppppppppppWk
kWppppppppppWWWpppppppppWk
kWpppWWWppppWlWpppWWWWWpWk
kWpppWlWppppWWWpppWlllWpWk
kWpppWWWppppppppppWWWWWpWk
kWppppppppppppppppppppppWk
kWWWWWWWWWWWWWWWWWWWWWWWWk
kkkkkkkkkkkkkkkkkkkkkkkkkk`),
      objects: [
        { k: 'statueA', tx: 3, ty: 1 }, { k: 'statueB', tx: 22, ty: 1 }, { k: 'demon', tx: 11, ty: 1 }, { k: 'gargoyle', tx: 15, ty: 12 },
        { k: 'pillar', tx: 2, ty: 7 }, { k: 'pillar', tx: 22, ty: 7 }, { k: 'altar', tx: 12, ty: 12 }, { k: 'torch', tx: 9, ty: 3 }, { k: 'torch', tx: 16, ty: 3 },
        { k: 'pot', tx: 2, ty: 12 }, { k: 'pot2', tx: 3, ty: 12 }, { k: 'pot', tx: 22, ty: 2 }, { k: 'pot2', tx: 20, ty: 12 },
        { k: 'skull', tx: 7, ty: 8 }, { k: 'bones', tx: 17, ty: 8 }, { k: 'skull', tx: 12, ty: 13 },
        { k: 'banner', tx: 6, ty: 0 }, { k: 'banner2', tx: 9, ty: 0 }, { k: 'banner', tx: 17, ty: 0 }, { k: 'banner2', tx: 20, ty: 0 },
        { k: 'lantern', tx: 5, ty: 3 }, { k: 'lantern', tx: 19, ty: 3 }, { k: 'lantern', tx: 7, ty: 11 }, { k: 'lantern', tx: 21, ty: 10 },
        { k: 'grate', tx: 12, ty: 5 }, { k: 'plates', tx: 5, ty: 8 },
      ],
    },
  ];

  // resolve o mapa: grade de bloqueio, objetos com ocupação e pontos de nascimento (afastados, livres)
  function build(i) {
    const a = ARENAS[((i % ARENAS.length) + ARENAS.length) % ARENAS.length];
    const ground = a.ground; const rowsN = ground.length, cols = ground[0].length;
    const blocked = ground.map((row) => row.split('').map((ch) => (ch === 'w' || ch === 'l' || ch === 'k' || ch === 'W') ? 1 : 0));
    const objects = [];
    for (const o of a.objects) {
      const def = K[o.k]; if (!def) continue;
      const tw = def.tw || 1, th = def.th || 1;
      objects.push({ key: o.k, tx: o.tx, ty: o.ty, tw, th, deco: !!def.deco });
      if (def.block) for (let y = o.ty; y < o.ty + th; y++) for (let x = o.tx; x < o.tx + tw; x++) if (y >= 0 && x >= 0 && y < rowsN && x < cols) blocked[y][x] = 1;
    }
    // nascimentos: tiles livres afastados (≥ 5 tiles), determinístico
    const free = []; for (let r = 1; r < rowsN - 1; r++) for (let c = 1; c < cols - 1; c++) if (!blocked[r][c] && !blocked[r - 1][c] && !blocked[r + 1][c]) free.push([r, c]);
    const spawns = []; let seed = 12345 + i * 777;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const order = free.slice().sort(() => rnd() - 0.5);
    for (const [r, c] of order) { const x = c * TILE + TILE / 2, y = r * TILE + TILE / 2; if (spawns.every((s) => Math.hypot(s.x - x, s.y - y) >= 5 * TILE)) spawns.push({ x, y }); if (spawns.length >= 12) break; }
    return { index: i, name: a.name, theme: a.theme, tile: TILE, cols, rows: rowsN, width: cols * TILE, height: rowsN * TILE, ground, blocked, objects, spawns, keys: K };
  }
  return { build, count: ARENAS.length, keys: K, TILE };
});
