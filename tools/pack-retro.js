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
  waterBlock: { x: 272, y: 304, w: 48, h: 48 },   // bloco 3×3 de água com borda
  sandBlock: { x: 272 + 48 * 2, y: 304, w: 48, h: 48 },
};
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ tiles, objects }));
for (const [k, v] of Object.entries(objects)) console.log(k.padEnd(7), v.length, 'ex:', JSON.stringify(v.slice(0, 3)));
console.log('atlas', W + 'x' + H, Math.round(fs.statSync(path.join(OUT, 'atlas.png')).size / 1024) + 'KB');
