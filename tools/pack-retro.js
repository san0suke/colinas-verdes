// Empacota o atlas da Super Retro Collection para a arena: copia o atlas e extrai os objetos
// (árvores, arbustos, pedras, tufos) por componentes conexos de regiões conhecidas do atlas.
// Uso: node tools/pack-retro.js [pasta Resources do asset]
'use strict';
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SRC = process.argv[2] || 'E:/Unity/emptyProjectForAssets/New Unity Project/Assets/Gif/Super_Retro_Collection/Resources';
const OUT = path.join(__dirname, '..', 'assets', 'retro');
fs.mkdirSync(OUT, { recursive: true });
const atlas = PNG.sync.read(fs.readFileSync(path.join(SRC, 'Environments/original_atlas.png')));
fs.copyFileSync(path.join(SRC, 'Environments/original_atlas.png'), path.join(OUT, 'atlas.png'));

const W = atlas.width, H = atlas.height;
const alpha = (x, y) => atlas.data[(y * W + x) * 4 + 3];

// componentes conexos (8-vizinhança) dentro de uma região; ignora sprites com menos de `minPx` pixels
function components(x0, y0, x1, y1, minPx = 12) {
  const seen = new Uint8Array(W * H);
  const out = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (seen[y * W + x] || alpha(x, y) < 20) continue;
    let minX = x, maxX = x, minY = y, maxY = y, n = 0;
    const stack = [[x, y]]; seen[y * W + x] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop(); n++;
      minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1 || seen[ny * W + nx] || alpha(nx, ny) < 20) continue;
        seen[ny * W + nx] = 1; stack.push([nx, ny]);
      }
    }
    if (n >= minPx) out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return out;
}

const objects = { tree: [], bush: [], rock: [], tuft: [], flower: [] };
// árvores e arbustos (seção "Trees, bushes"), sem a área das cercas (x ≥ 630, y < 150)
for (const c of components(256, 8, 768, 250)) {
  if (c.x >= 630 && c.y < 150 && c.h < 30) continue;          // cerca
  if (c.w > 80 || c.h > 80) continue;                         // caixa gigante = fundo/ruído
  if (c.h >= 36 && c.w >= 20) objects.tree.push(c);
  else if (c.h >= 20 && c.w >= 18) objects.bush.push(c);
  else if (c.w <= 18 && c.h <= 18) objects.flower.push(c);
}
// pedras (seção "Rocks"), sem cristais/lava (x ≥ 140)
for (const c of components(0, 264, 140, 512)) { if (c.w >= 10 && c.w <= 56 && c.h <= 48) objects.rock.push(c); }
// grama: tufos pequenos e arbustos grandes (seção "Grass textures")
for (const c of components(0, 8, 256, 250)) {
  if (c.w <= 18 && c.h <= 14) objects.tuft.push(c);
  else if (c.w >= 24 && c.h >= 20 && c.w <= 70) objects.bush.push(c);
}
// tiles de chão/água: centros dos blocos 3×3 da seção "Roads, floors" e textura de água
const tiles = {
  grass: { x: 480, y: 320, w: 16, h: 16 },
  grassBlock: { x: 464, y: 304, w: 48, h: 48 },   // bloco 3×3 com borda arredondada (9 fatias)
  dirt: { x: 384, y: 320, w: 16, h: 16 },
  dirtBlock: { x: 368, y: 304, w: 48, h: 48 },
  stone: { x: 336, y: 320, w: 16, h: 16 },
  stoneBlock: { x: 320, y: 304, w: 48, h: 48 },
  water: { x: 192, y: 528, w: 48, h: 48 },        // textura repetível
  snow: { x: 432, y: 320, w: 16, h: 16 },          // centro do bloco branco
  earth: { x: 576, y: 482, w: 16, h: 16 },         // terra marrom (trilhas)
  sand: { x: 384, y: 320, w: 16, h: 16 },
  waterBlock: { x: 272, y: 304, w: 48, h: 48 },   // bloco 3×3 de água com borda
  sandBlock: { x: 272 + 48 * 2, y: 304, w: 48, h: 48 },
};
// bioma de cada objeto pela cor média (matiz/saturação) dos pixels opacos; cactos pela região do atlas
function biomeOf(o, kind) {
  let r = 0, g = 0, b = 0, n = 0, bluePx = 0;
  for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) { const i = (y * W + x) * 4; if (atlas.data[i + 3] < 20) continue; const pr = atlas.data[i], pg = atlas.data[i + 1], pb = atlas.data[i + 2]; r += pr; g += pg; b += pb; n++; if (pb > pr + 40 && pb > pg - 10 && pb > 120) bluePx++; }
  r /= n; g /= n; b /= n;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), sat = max ? (max - min) / max : 0;
  let hue = 0; if (max !== min) { if (max === r) hue = ((g - b) / (max - min)) % 6; else if (max === g) hue = (b - r) / (max - min) + 2; else hue = (r - g) / (max - min) + 4; hue = (hue * 60 + 360) % 360; }
  const blue = hue >= 150 && hue <= 240, green = hue >= 60 && hue < 150, purple = hue > 240 && hue <= 335, warm = hue < 60 || hue > 335;
  if (o.x >= 350 && o.x <= 450 && o.y >= 120 && o.y <= 200) return 'desert'; // cactos (qualquer tamanho)
  if (kind !== 'rock' && bluePx / n > 0.08) return 'winter'; // tem pedaços azuis/ciano (ex.: flor de gelo junto de troncos)
  if (kind === 'rock') {
    if (blue && sat > 0.18) return 'winter';       // pedras de gelo
    if (green && sat > 0.08) return 'forest';      // com musgo
    if (warm && sat > 0.2) return 'desert';        // alaranjadas
    return 'any';                                  // cinza
  }
  if (blue && sat > 0.05) return 'winter';         // qualquer coisa azulada/ciano só no inverno
  if (sat < 0.12) return 'any';
  if (green) return (kind === 'tuft' || kind === 'flower') ? 'any' : 'forest'; // tufos verdes servem em todo lugar
  if (purple) return 'mystic';
  if (warm) return 'autumn';
  return 'any';
}
const BIOMES = ['forest', 'autumn', 'winter', 'mystic', 'desert'];
const biomes = {};
for (const bm of BIOMES) biomes[bm] = { tree: [], bush: [], rock: [], tuft: [], flower: [] };
for (const [kind, list] of Object.entries(objects)) for (const o of list) {
  const bmo = biomeOf(o, kind);
  for (const bm of BIOMES) {
    if (bmo === 'any' || bmo === bm) biomes[bm][kind].push(o);
    else if (bm === 'desert' && kind === 'rock' && bmo === 'autumn') biomes[bm][kind].push(o);
  }
}
for (const bm of BIOMES) console.log('bioma', bm.padEnd(7), Object.entries(biomes[bm]).map(([k, v]) => k + ':' + v.length).join(' '));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ tiles, objects, biomes }));
for (const [k, v] of Object.entries(objects)) console.log(k.padEnd(7), v.length, 'ex:', JSON.stringify(v.slice(0, 3)));
console.log('atlas', W + 'x' + H, Math.round(fs.statSync(path.join(OUT, 'atlas.png')).size / 1024) + 'KB');
