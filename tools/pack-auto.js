// Empacota os autotiles (grade dual 4×4, 4 quadros) de água/trilha e a cachoeira do Super Retro Collection em assets/retro/auto.png
const { PNG } = require('pngjs'); const fs = require('fs'); const path = require('path');
const SRC = 'E:/Unity/emptyProjectForAssets/New Unity Project/Assets/Gif/Super_Retro_Collection/Resources/';
const A = SRC + 'Environments/TilePalette/Autotiles/root/atlas/';
const parts = [ // [arquivo, x, y]
  ['anim_autotile_2.png', 0, 0],     // grama + água azul (vila/floresta) 256×64
  ['anim_autotile_0.png', 0, 64],    // grama + água ciano
  ['anim_autotile_1.png', 0, 128],   // neve + água ciano
  ['anim_autotile_6.png', 0, 192],   // areia + água ciano (oásis)
  ['anim_autotile_4.png', 0, 256],   // pedra + lava
  ['ground_autotile_5.png', 0, 320], // grama + terra alaranjada (trilha) 64×64
  ['anim_autotile_7.png', 64, 320],  // cachoeira azul: 3 colunas (esq/meio/dir) × 3 quadros = 144×16
];
const out = new PNG({ width: 256, height: 384 });
for (const [f, x, y] of parts) {
  const p = PNG.sync.read(fs.readFileSync(A + f));
  for (let j = 0; j < p.height; j++) for (let i = 0; i < p.width; i++) { const si = (j * p.width + i) * 4, di = ((y + j) * 256 + x + i) * 4; for (let k = 0; k < 4; k++) out.data[di + k] = p.data[si + k]; }
}
const eff = PNG.sync.read(fs.readFileSync(SRC + 'Animations/Water/waterfall_effect_01_16x32.png')); // espuma da base: 3 quadros 16×32
for (let j = 0; j < eff.height; j++) for (let i = 0; i < eff.width; i++) { const si = (j * eff.width + i) * 4, di = ((336 + j) * 256 + 64 + i) * 4; for (let k = 0; k < 4; k++) out.data[di + k] = eff.data[si + k]; }
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'retro', 'auto.png'), PNG.sync.write(out));
console.log('auto.png ok');
