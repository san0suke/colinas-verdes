// Controles de toque (celular): joystick à esquerda, botão de pular à direita, sair no canto.
(() => {
  const stick = document.getElementById('stick');
  const knob = document.getElementById('knob');
  const jump = document.getElementById('jump');
  const leave = document.getElementById('touch-leave');
  if (!stick || !jump) return;

  const RADIUS = 44;        // curso máximo do knob (px)
  const DEAD = 0.25;        // zona morta (fração do raio)
  let pointerId = null, cx = 0, cy = 0;

  function moveKnob(dx, dy) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  function onMove(e) {
    if (e.pointerId !== pointerId) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx *= RADIUS / len; dy *= RADIUS / len; }
    moveKnob(dx, dy);
    const h = dx / RADIUS;
    Game.setVirtualInput({ left: h < -DEAD, right: h > DEAD });
  }
  function release(e) {
    if (e && e.pointerId !== pointerId) return;
    pointerId = null;
    moveKnob(0, 0);
    Game.setVirtualInput({ left: false, right: false });
  }

  stick.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    stick.setPointerCapture(e.pointerId);
    onMove(e);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', onMove);
  stick.addEventListener('pointerup', release);
  stick.addEventListener('pointercancel', release);
  stick.addEventListener('lostpointercapture', release);

  const press = (e) => { Game.setVirtualInput({ jump: true }); e.preventDefault(); };
  const unpress = () => Game.setVirtualInput({ jump: false });
  jump.addEventListener('pointerdown', press);
  jump.addEventListener('pointerup', unpress);
  jump.addEventListener('pointercancel', unpress);
  jump.addEventListener('pointerleave', unpress);
  jump.addEventListener('contextmenu', (e) => e.preventDefault());

  leave.addEventListener('click', () => document.getElementById('leave').click());
})();
