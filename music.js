// Música: trilha de fundo sorteada entre as faixas medievais, jingles de vitória e de
// chegada, e botão de mudo (que também silencia os efeitos do jogo).
const Music = (() => {
  const TRACKS = Array.from({ length: 8 }, (_, i) => `assets/music/medieval-${i + 1}.mp3`);
  const JINGLES = { victory: 'assets/music/victory.wav', complete: 'assets/music/complete.wav' };
  const BG_VOLUME = 0.35, JINGLE_VOLUME = 0.7;

  let bg = null, jingle = null, lastTrack = -1, wanted = false;
  let muted = false;
  try { muted = localStorage.getItem('muted') === '1'; } catch {}

  function pickTrack() {
    let i; do i = Math.floor(Math.random() * TRACKS.length); while (TRACKS.length > 1 && i === lastTrack);
    lastTrack = i;
    return TRACKS[i];
  }
  function playNext() {
    if (!wanted) return;
    if (bg) { bg.onended = null; bg.pause(); }
    bg = new Audio(pickTrack());
    bg.volume = BG_VOLUME; bg.muted = muted; bg.preload = 'auto';
    bg.onended = playNext;                 // acabou a faixa → sorteia outra
    bg.play().catch(() => {});              // autoplay bloqueado: tenta de novo no próximo gesto (start())
  }

  // Chamar a partir de um gesto do usuário (clique/toque). Idempotente: se já toca, só garante que continua.
  function start() {
    wanted = true;
    if (jingle && !jingle.paused) return;   // o jingle termina e retoma sozinho
    if (bg && !bg.paused) return;
    if (bg && bg.paused && bg.currentTime > 0 && !bg.ended) { bg.play().catch(() => {}); return; }
    playNext();
  }
  function stop() {
    wanted = false;
    if (bg) { bg.onended = null; bg.pause(); bg = null; }
    if (jingle) { jingle.onended = null; jingle.pause(); jingle = null; }
  }
  // 'victory' (venceu) ou 'complete' (chegou sem vencer): pausa a trilha e retoma ao terminar
  function playJingle(kind) {
    const src = JINGLES[kind];
    if (!src) return;
    if (jingle) { jingle.onended = null; jingle.pause(); }
    if (bg) bg.pause();
    jingle = new Audio(src);
    jingle.volume = JINGLE_VOLUME; jingle.muted = muted;
    jingle.onended = () => { jingle = null; if (wanted && bg) bg.play().catch(() => {}); };
    jingle.play().catch(() => { jingle = null; if (wanted && bg) bg.play().catch(() => {}); });
  }
  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem('muted', muted ? '1' : '0'); } catch {}
    if (bg) bg.muted = muted;
    if (jingle) jingle.muted = muted;
    if (typeof Game !== 'undefined') Game.setMuted(muted);
    for (const b of document.querySelectorAll('[data-mute]')) { b.textContent = muted ? '🔇' : '🔊'; b.setAttribute('aria-pressed', String(muted)); b.title = muted ? 'Ativar som' : 'Silenciar'; }
  }
  const isMuted = () => muted;

  document.addEventListener('DOMContentLoaded', () => {
    setMuted(muted);
    for (const b of document.querySelectorAll('[data-mute]')) b.addEventListener('click', () => setMuted(!muted));
  });

  return { start, stop, playJingle, setMuted, isMuted };
})();
