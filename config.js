// Endereço do servidor de salas (WebSocket).
// Quando a página é servida pelo próprio servidor Node (local ou Render), usa a mesma origem.
// No GitHub Pages, aponta para o serviço no Render.
window.SERVER_URL = location.hostname.endsWith('github.io')
  ? 'wss://colinas-verdes.onrender.com'
  : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
