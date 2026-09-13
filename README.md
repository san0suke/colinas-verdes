# Colinas Verdes

Corrida de plataforma online no navegador: lobby com salas públicas/privadas (com senha), fases geradas proceduralmente a cada corrida (chão, buracos, plataformas, molas, espinhos, inimigos, moedas), largada com contagem regressiva, chegada na bandeira e placar. A corrida termina quando o penúltimo jogador cruza a chegada; quem entra no meio começa do início.

Assets: [Kenney — New Platformer Pack](https://kenney.nl/assets/new-platformer-pack) (CC0).

## Rodar local

```
npm install
npm start        # http://localhost:8000 (página + servidor de salas)
```

## Estrutura

- `index.html`, `game.js` (motor: física, inimigos, render), `level.js` (gerador de fases, compartilhado com o servidor), `lobby.js` (salas, corrida e placar), `touch.js` (controles no celular), `config.js` (endereço do servidor)
- `server/server.js` — servidor Node: salas em memória (apagadas quando o último jogador sai), senha (SHA-256), relay de posições, arquivos estáticos
- `assets/sheets/` — spritesheets do pack (tiles, inimigos, personagens, fundos) · `assets/sounds/` — efeitos
- Teste: `?solo=1&seed=42` abre direto jogando sozinho numa fase fixa
- `build.py` — bundle de página única (usado para publicar como Artifact do claude.ai; opcional)

## Deploy

- **Página:** GitHub Pages (branch `main`, raiz).
- **Servidor:** Render Web Service (`render.yaml`), plano gratuito. `config.js` aponta o GitHub Pages para `wss://colinas-verdes.onrender.com`; se o serviço tiver outro nome, ajuste ali.

O plano gratuito do Render dorme após ~15 min sem uso: o primeiro jogador espera ~30 s até o servidor acordar (o lobby mostra "Conectando…" e reconecta sozinho).
