# Colinas Verdes

Protótipo de plataforma online no navegador: lobby com salas públicas/privadas (com senha), personagem com pulo, fundo parallax e jogadores sincronizados por WebSocket.

Assets: [Kenney — New Platformer Pack](https://kenney.nl/assets/new-platformer-pack) (CC0).

## Rodar local

```
npm install
npm start        # http://localhost:8000 (página + servidor de salas)
```

## Estrutura

- `index.html`, `game.js` (motor), `lobby.js` (salas/rede no cliente), `config.js` (endereço do servidor)
- `server/server.js` — servidor Node: salas em memória (apagadas quando o último jogador sai), senha (SHA-256), relay de posições, arquivos estáticos
- `assets/` — só os sprites usados
- `build.py` — bundle de página única (usado para publicar como Artifact do claude.ai; opcional)

## Deploy

- **Página:** GitHub Pages (branch `main`, raiz).
- **Servidor:** Render Web Service (`render.yaml`), plano gratuito. `config.js` aponta o GitHub Pages para `wss://colinas-verdes.onrender.com`; se o serviço tiver outro nome, ajuste ali.

O plano gratuito do Render dorme após ~15 min sem uso: o primeiro jogador espera ~30 s até o servidor acordar (o lobby mostra "Conectando…" e reconecta sozinho).
