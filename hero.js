// Heróis do "Pixel Hero Maker": compõe as camadas escolhidas numa tira de quadros e desenha no canvas.
// config = { race, hair, hairColor, armor, helmet, weapon, shield, back, mask, bracers, horns }
// (nomes das peças em assets/heroes/index.json; '' = sem a peça)
const Hero = (() => {
  const FRAME = 64;
  const BASE = 'assets/heroes/';
  const RACE_LAYERS = ['Body', 'Head', 'Eyes', 'Arms', 'Ears'];          // seguem a raça
  const EQUIP = { hair: 'Hair', armor: 'Armor', helmet: 'Helmet', weapon: 'Weapon', shield: 'Shield', back: 'Back', mask: 'Mask', bracers: 'Bracers', horns: 'Horns' };
  const ANIM = { i: ['Idle_0', 'Idle_1'], w: ['Run_0', 'Run_1', 'Run_2', 'Run_3'], j: ['Jump_1'], h: ['Death_0'], a: ['Slash_0', 'Slash_1', 'Slash_2', 'Slash_3'], d: ['Death_2'] };
  const FPS = { i: 2, w: 10, j: 1, h: 1, a: 12, d: 1 };
  const HAIR_COLORS = ['', '#2b1d0e', '#6b3e1e', '#b5651d', '#e0b04a', '#f2e6b3', '#c0392b', '#e67e22', '#8e44ad', '#2e86de', '#27ae60', '#ecf0f1', '#111111', '#ff69b4'];

  let index = null, loading = null;
  const images = new Map();   // "Layer/Item" -> Promise<Image>
  const strips = new Map();   // chave da config -> { canvas } | { pending }

  function load() {
    if (loading) return loading;
    loading = fetch(BASE + 'index.json').then((r) => r.json()).then((i) => { index = i; return i; });
    return loading;
  }
  const ready = () => !!index;
  function image(layer, item) {
    const k = layer + '/' + item;
    if (!images.has(k)) images.set(k, new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('peça não encontrada: ' + k)); im.src = BASE + layer + '/' + item + '.png'; }));
    return images.get(k);
  }
  const items = (layer) => (index && index.layers.find((l) => l.name === layer) || { items: [] }).items;
  const has = (layer, item) => items(layer).includes(item);

  // garante que a config só usa peças existentes
  function sanitize(cfg) {
    const c = Object.assign({}, cfg || {});
    if (!index) return c;
    if (!has('Body', c.race)) c.race = 'Human';
    for (const [key, layer] of Object.entries(EQUIP)) if (c[key] && !has(layer, c[key])) c[key] = '';
    if (typeof c.hairColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(c.hairColor)) c.hairColor = '';
    return c;
  }
  function defaultConfig() { return { race: 'Human', hair: 'Hair1', hairColor: '', armor: '', helmet: '', weapon: '', shield: '', back: '', mask: '', bracers: '', horns: '' }; }
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const maybe = (arr, p) => (Math.random() < p ? pick(arr) : '');
  function random() {
    const c = defaultConfig();
    c.race = pick(index.races);
    c.hair = maybe(items('Hair'), 0.85); c.hairColor = pick(HAIR_COLORS);
    c.armor = maybe(items('Armor'), 0.85); c.helmet = maybe(items('Helmet'), 0.5); c.weapon = maybe(items('Weapon'), 0.8);
    c.shield = maybe(items('Shield'), 0.3); c.back = maybe(items('Back'), 0.3); c.mask = maybe(items('Mask'), 0.15);
    c.bracers = maybe(items('Bracers'), 0.5); c.horns = maybe(items('Horns'), 0.1);
    return c;
  }
  const key = (cfg) => JSON.stringify(sanitize(cfg));
  const encode = (cfg) => key(cfg);
  function decode(s) { try { return sanitize(JSON.parse(s)); } catch { return null; } }

  // camadas a desenhar, na ordem do índice
  function layersFor(cfg) {
    const out = [];
    for (const l of index.layers) {
      if (RACE_LAYERS.includes(l.name)) { if (l.items.includes(cfg.race)) out.push([l.name, cfg.race]); continue; }
      const k = Object.keys(EQUIP).find((e) => EQUIP[e] === l.name);
      if (k && cfg[k]) out.push([l.name, cfg[k]]);
    }
    return out;
  }
  // recolore o cabelo mantendo o sombreado (composição "color": matiz+saturação da cor, luminosidade do sprite)
  function tinted(img, color) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'color'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(img, 0, 0);
    return c;
  }
  async function compose(cfg) {
    await load();
    cfg = sanitize(cfg);
    const layers = layersFor(cfg);
    const imgs = await Promise.all(layers.map(([l, i]) => image(l, i)));
    const c = document.createElement('canvas'); c.width = FRAME * index.frames.length; c.height = FRAME;
    const g = c.getContext('2d');
    layers.forEach(([l], i) => { let im = imgs[i]; if (l === 'Hair' && cfg.hairColor) im = tinted(im, cfg.hairColor); g.drawImage(im, 0, 0); });
    return c;
  }
  // tira pronta (ou null enquanto carrega; dispara a composição uma vez por config)
  function get(cfg) {
    const k = key(cfg);
    const e = strips.get(k);
    if (e) return e.canvas || null;
    const entry = { canvas: null };
    strips.set(k, entry);
    compose(cfg).then((c) => { entry.canvas = c; }).catch(() => { strips.delete(k); });
    return null;
  }
  function frameIndex(anim, t) {
    const seq = ANIM[anim] || ANIM.i;
    const k = Math.floor(t * (FPS[anim] || 2));
    const name = anim === 'a' ? seq[Math.min(seq.length - 1, k)] : seq[k % seq.length];
    return index.frames.indexOf(name);
  }
  // desenha o herói com os pés em (x, y); retorna false se ainda não está pronto
  function draw(ctx, cfg, anim, t, x, y, flip, scale) {
    if (!index) return false;
    const strip = get(cfg);
    if (!strip) return false;
    const f = frameIndex(anim, t), s = FRAME * scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(x), Math.round(y - (index.feet + 1) * scale));
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(strip, f * FRAME, 0, FRAME, FRAME, -s / 2, 0, s, s);
    ctx.restore();
    return true;
  }
  // miniatura de uma peça (quadro "Icon"), para o editor
  async function thumb(ctx, layer, item, x, y, size) {
    const im = await image(layer, item);
    const f = index.frames.indexOf('Icon');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, f * FRAME, 0, 32, 32, x, y, size, size); // o ícone ocupa o canto 32×32 do quadro
  }
  return { load, ready, items, has, sanitize, defaultConfig, random, encode, decode, get, draw, thumb, compose, EQUIP, HAIR_COLORS, FRAME, get index() { return index; } };
})();
