// Empacota o asset "Pixel Hero Maker" (Unity) para o jogo: de cada peça (folha 576×928 com 48 quadros
// de 64×64) recorta só os quadros usados e grava uma tira em assets/heroes/<camada>/<peça>.png,
// além de assets/heroes/index.json (camadas na ordem de desenho, peças, raças, quadros).
// Uso: node tools/pack-heroes.js [pasta do asset]
'use strict';
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SRC = process.argv[2] || 'E:/Unity/emptyProjectForAssets/New Unity Project/Assets/PixelFantasy/PixelHeroes';
const OUT = path.join(__dirname, '..', 'assets', 'heroes');
const FRAMES = ['Idle_0', 'Idle_1', 'Run_0', 'Run_1', 'Run_2', 'Run_3', 'Jump_0', 'Jump_1', 'Jump_2', 'Death_0', 'Icon'];
// ordem de desenho (SpriteCollection.asset), sem Cape/Firearm/Mouth (tratamento especial no Unity / sem pasta)
const LAYERS = [
  ['Back', 'FantasyHeroes/Sprites/Back'], ['Shield', 'FantasyHeroes/Sprites/Shield'], ['Body', 'FantasyHeroes/Sprites/Body'],
  ['Armor', 'FantasyHeroes/Sprites/Armor'], ['Head', 'FantasyHeroes/Sprites/Head'], ['Horns', 'FantasyHeroes/Sprites/Horns'],
  ['Eyes', 'FantasyHeroes/Sprites/Eyes'], ['Mask', 'FantasyHeroes/Sprites/Mask'], ['Hair', 'Common/Sprites/Hair'],
  ['Ears', 'FantasyHeroes/Sprites/Ears'], ['Helmet', 'FantasyHeroes/Sprites/Helmet'], ['Arms', 'FantasyHeroes/Sprites/Arms'],
  ['Bracers', 'FantasyHeroes/Sprites/Bracers'], ['Weapon', 'FantasyHeroes/Sprites/Weapon'],
];

// retângulos dos quadros (Example.png.meta; y do Unity conta de baixo para cima)
const meta = fs.readFileSync(path.join(SRC, 'Common/Sprites/Example.png.meta'), 'utf8');
const rects = {};
const re = /name: (\w+)\n\s+rect:\n\s+serializedVersion: \d+\n\s+x: (\d+)\n\s+y: (\d+)\n\s+width: (\d+)\n\s+height: (\d+)/g;
let m; while ((m = re.exec(meta))) rects[m[1]] = { x: +m[2], y: 928 - +m[3] - +m[5], w: +m[4], h: +m[5] };
for (const f of FRAMES) if (!rects[f]) throw new Error('quadro sem retângulo: ' + f);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const index = { frames: FRAMES, frameSize: 64, feet: 0, layers: [], races: [] };
let total = 0, files = 0, feet = 0;

for (const [name, dir] of LAYERS) {
  const full = path.join(SRC, dir);
  const items = fs.readdirSync(full).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort();
  fs.mkdirSync(path.join(OUT, name), { recursive: true });
  for (const item of items) {
    const src = PNG.sync.read(fs.readFileSync(path.join(full, item + '.png')));
    if (src.width !== 576 || src.height !== 928) { console.warn('pulando (tamanho inesperado):', name, item); continue; }
    const strip = new PNG({ width: 64 * FRAMES.length, height: 64 });
    FRAMES.forEach((f, i) => { const r = rects[f]; PNG.bitblt(src, strip, r.x, r.y, r.w, r.h, i * 64, 0); });
    if (name === 'Body') { // linha mais baixa opaca do Idle_0 = pés
      for (let y = 63; y >= 0 && !feet; y--) for (let x = 0; x < 64; x++) if (strip.data[(y * strip.width + x) * 4 + 3] > 0) { feet = Math.max(feet, y); break; }
    }
    const buf = PNG.sync.write(strip, { deflateLevel: 9 });
    fs.writeFileSync(path.join(OUT, name, item + '.png'), buf);
    total += buf.length; files++;
  }
  index.layers.push({ name, items });
}
index.feet = feet;
index.races = index.layers.find((l) => l.name === 'Body').items;
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
console.log(`${files} peças, ${(total / 1024 / 1024).toFixed(1)} MB, pés na linha ${feet}`);
