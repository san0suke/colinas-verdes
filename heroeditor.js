// Editor de personagem (tela "Personagem" do lobby): raça, cabelo (com cor) e equipamentos.
// Salva em localStorage['hero'] e avisa o lobby com o evento 'hero-changed'.
const HeroEditor = (() => {
  const $ = (id) => document.getElementById(id);
  const TABS = [
    { key: 'race', label: 'Raça', layer: 'Body', none: false },
    { key: 'hair', label: 'Cabelo', layer: 'Hair', none: true },
    { key: 'armor', label: 'Armadura', layer: 'Armor', none: true },
    { key: 'helmet', label: 'Capacete', layer: 'Helmet', none: true },
    { key: 'weapon', label: 'Arma', layer: 'Weapon', none: true },
    { key: 'shield', label: 'Escudo', layer: 'Shield', none: true },
    { key: 'bracers', label: 'Braçadeiras', layer: 'Bracers', none: true },
    { key: 'back', label: 'Costas', layer: 'Back', none: true },
    { key: 'mask', label: 'Máscara', layer: 'Mask', none: true },
    { key: 'horns', label: 'Chifres', layer: 'Horns', none: true },
  ];
  let cfg = null, tab = 'race', raf = 0, open = false, onClose = null;
  let els = {};

  function saved() { try { return Hero.decode(localStorage.getItem('hero') || ''); } catch { return null; } }
  function current() { return saved() || Hero.sanitize(Hero.defaultConfig()); }

  function init(opts) {
    onClose = opts && opts.onClose;
    els = { screen: $('heroscreen'), preview: $('hero-preview'), tabs: $('hero-tabs'), grid: $('hero-grid'), colors: $('hero-colors'), name: $('hero-item-name') };
    $('hero-back').addEventListener('click', close);
    $('hero-save').addEventListener('click', save);
    $('hero-random').addEventListener('click', () => { cfg = Hero.random(); render(); });
    $('hero-clear').addEventListener('click', () => { for (const k of Object.keys(Hero.EQUIP)) cfg[k] = ''; render(); });
  }
  async function show() {
    await Hero.load();
    cfg = current();
    open = true;
    els.screen.hidden = false;
    renderTabs(); render();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function close() { open = false; els.screen.hidden = true; cancelAnimationFrame(raf); if (onClose) onClose(); }
  function save() {
    try { localStorage.setItem('hero', Hero.encode(cfg)); } catch {}
    window.dispatchEvent(new CustomEvent('hero-changed', { detail: Hero.encode(cfg) }));
    close();
  }

  // prévia animada: idle 2 s, corrida 2 s, pulo 1 s…
  function loop(ts) {
    if (!open) return;
    const t = ts / 1000, cycle = t % 5, anim = cycle < 2 ? 'i' : cycle < 4 ? 'w' : 'j';
    const ctx = els.preview.getContext('2d');
    ctx.clearRect(0, 0, els.preview.width, els.preview.height);
    Hero.draw(ctx, cfg, anim, t, els.preview.width / 2, els.preview.height - 24, false, 6);
    raf = requestAnimationFrame(loop);
  }

  function renderTabs() {
    els.tabs.innerHTML = '';
    for (const t of TABS) {
      if (t.layer === 'Horns' && !Hero.items('Horns').length) continue;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'hero-tab' + (t.key === tab ? ' active' : ''); b.textContent = t.label;
      b.addEventListener('click', () => { tab = t.key; renderTabs(); render(); });
      els.tabs.appendChild(b);
    }
  }
  function render() {
    const t = TABS.find((x) => x.key === tab);
    const list = Hero.items(t.layer);
    els.grid.innerHTML = '';
    if (t.none) els.grid.appendChild(cell(t, '', 'Nenhum'));
    for (const item of list) els.grid.appendChild(cell(t, item, item.replace(/([a-z])([A-Z])/g, '$1 $2')));
    els.colors.hidden = tab !== 'hair';
    if (tab === 'hair') renderColors();
    const val = cfg[t.key];
    els.name.textContent = t.label + ': ' + (val ? val.replace(/([a-z])([A-Z])/g, '$1 $2') : 'nenhum');
  }
  function cell(t, item, label) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'hero-cell' + (cfg[t.key] === item ? ' selected' : ''); b.title = label;
    if (item) {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      Hero.thumb(c.getContext('2d'), t.layer, item, 0, 0, 64).catch(() => {});
      b.appendChild(c);
    } else { b.textContent = '✕'; b.classList.add('none'); }
    b.addEventListener('click', () => { cfg[t.key] = item; render(); });
    return b;
  }
  function renderColors() {
    els.colors.innerHTML = '';
    for (const color of Hero.HAIR_COLORS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'hero-color' + (cfg.hairColor === color ? ' selected' : '');
      b.style.background = color || 'linear-gradient(135deg,#6b3e1e,#b5651d)'; b.title = color ? color : 'Cor original';
      b.addEventListener('click', () => { cfg.hairColor = color; render(); });
      els.colors.appendChild(b);
    }
    const custom = document.createElement('input');
    custom.type = 'color'; custom.value = cfg.hairColor || '#6b3e1e'; custom.title = 'Outra cor';
    custom.addEventListener('input', () => { cfg.hairColor = custom.value; });
    custom.addEventListener('change', () => { cfg.hairColor = custom.value; render(); });
    els.colors.appendChild(custom);
  }
  return { init, show, close, current };
})();
