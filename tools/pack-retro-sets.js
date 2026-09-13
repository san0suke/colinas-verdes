// Extrai "conjuntos" de sprites do atlas Super Retro por componentes conexos de regiões nomeadas,
// para as arenas fixas (arenas.js referencia set + índice). Gera assets/retro/sets.json e folhas de
// contato (scratch) numeradas por posição (12 por linha).
'use strict';
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const SRC = 'E:/Unity/emptyProjectForAssets/New Unity Project/Assets/Gif/Super_Retro_Collection/Resources';
const OUT = path.join(__dirname, '..', 'assets', 'retro');
const SHEETS = process.argv[2] || null; // pasta para as folhas de contato (opcional)
const atlas = PNG.sync.read(fs.readFileSync(path.join(SRC, 'Environments/original_atlas.png')));
const W = atlas.width, H = atlas.height;
const alpha = (x, y) => atlas.data[(y * W + x) * 4 + 3];
function components(x0, y0, x1, y1, minPx = 12, gap = 1) {
  const seen = new Uint8Array(W * H); const out = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (seen[y * W + x] || alpha(x, y) < 20) continue;
    let minX = x, maxX = x, minY = y, maxY = y, n = 0; const stack = [[x, y]]; seen[y * W + x] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop(); n++;
      minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
      for (let dy = -gap; dy <= gap; dy++) for (let dx = -gap; dx <= gap; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1 || seen[ny * W + nx] || alpha(nx, ny) < 20) continue;
        seen[ny * W + nx] = 1; stack.push([nx, ny]);
      }
    }
    if (n >= minPx) out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  // ordena por linha (y) e depois x para índices estáveis e legíveis
  return out.sort((a, b) => (Math.floor(a.y / 24) - Math.floor(b.y / 24)) || a.x - b.x);
}
const REGIONS = {
  houses: [1280, 8, 1536, 512, 40],
  dungeon: [768, 512, 1280, 900, 20],
  city: [1536, 256, 1792, 768, 20],
  overworld: [0, 1024, 768, 1280, 30],
  fences: [640, 8, 768, 150, 12],
  cliffs: [768, 8, 960, 512, 60],
};
const sets = {};
for (const [name, [x0, y0, x1, y1, minPx]] of Object.entries(REGIONS)) {
  sets[name] = components(x0, y0, x1, y1, minPx).filter((c) => c.w <= 160 && c.h <= 160);
  console.log(name.padEnd(10), sets[name].length, 'sprites');
}
const idx = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
idx.sets = sets;
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(idx));

const FONT = { '0': ['111','101','101','101','111'], '1': ['010','110','010','010','111'], '2': ['111','001','111','100','111'], '3': ['111','001','111','001','111'], '4': ['101','101','111','001','001'], '5': ['111','100','111','001','111'], '6': ['111','100','111','101','111'], '7': ['111','001','001','001','001'], '8': ['111','101','111','101','111'], '9': ['111','101','111','001','111'] };
function drawNumber(out, n, x0, y0, sc) {
  String(n).split('').forEach((ch, k) => { const gl = FONT[ch]; for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (gl[y][x] === '1') for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) { const di = ((y0 + y * sc + dy) * out.width + (x0 + k * 4 * sc + x * sc + dx)) * 4; out.data[di] = 255; out.data[di + 1] = 240; out.data[di + 2] = 80; out.data[di + 3] = 255; } });
}
if (SHEETS) {
  const S = 2, cell = 100, cols = 12;
  const all = Object.assign({}, sets, Object.fromEntries(Object.entries(idx.objects).map(([k, v]) => ['obj_' + k, v])));
  for (const [name, list] of Object.entries(all)) {
    const rows = Math.ceil(list.length / cols); if (!rows) continue;
    const out = new PNG({ width: cols * cell, height: rows * cell }); out.data.fill(70);
    list.forEach((o, i) => {
      const cx = (i % cols) * cell + 6, cy = Math.floor(i / cols) * cell + 6;
      const sc = Math.min(S, (cell - 12) / o.w, (cell - 12) / o.h);
      // fundo de célula alternado + marca de dezena (linha branca a cada 10)
      for (let y = 0; y < cell - 2; y++) for (let x = 0; x < cell - 2; x++) { const di = ((Math.floor(i / cols) * cell + y) * out.width + ((i % cols) * cell + x)) * 4; const v = (i % 2) ? 60 : 78; out.data[di] = v; out.data[di + 1] = v; out.data[di + 2] = v; out.data[di + 3] = 255; }
      for (let y = 0; y < o.h * sc; y++) for (let x = 0; x < o.w * sc; x++) {
        const si = ((o.y + Math.floor(y / sc)) * W + (o.x + Math.floor(x / sc))) * 4; if (atlas.data[si + 3] < 20) continue;
        const di = ((cy + y) * out.width + (cx + x)) * 4; out.data[di] = atlas.data[si]; out.data[di + 1] = atlas.data[si + 1]; out.data[di + 2] = atlas.data[si + 2]; out.data[di + 3] = 255;
      }
      drawNumber(out, i, (i % cols) * cell + 4, Math.floor(i / cols) * cell + cell - 16, 2);
    });
    fs.writeFileSync(path.join(SHEETS, 'set-' + name + '.png'), PNG.sync.write(out));
  }
  console.log('folhas em', SHEETS);
}
