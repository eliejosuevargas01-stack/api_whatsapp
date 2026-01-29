
# EVA

EVA significa **Eliezer Vargas Automacoes** e tambem homenageia o nome da loja da sua avo.

# Notas

O package.json e o arquivo que diz ao Node.js o que este projeto e, quais bibliotecas ele usa e como rodar o app.

Resumo por partes (do seu package.json):
- name e version: identificam o projeto.
- type: "module": ativa ES Modules (import/export).
- main: arquivo principal do app.
- scripts:
  - start: comando para rodar em producao.
  - dev: comando para rodar em modo desenvolvimento (com nodemon).
- dependencies: bibliotecas necessarias em producao (fastify, baileys etc).
- devDependencies: bibliotecas so para desenvolvimento.

Em resumo, o package.json e o coracao do projeto Node.js, definindo suas caracteristicas e dependencias.

# config.js

O `src/config.js` centraliza todas as variaveis de ambiente e garante valores padrao.

O que ele faz:
- carrega o `.env` automaticamente com `dotenv/config`;
- converte strings em numeros quando necessario (ex: `PORT`);
- expoe o objeto `config` com as chaves usadas no app;
- valida que `API_KEY` existe via `requireApiKey()`.

Chaves esperadas no `.env`:
- `PORT` (numero)
- `HOST` (ex: `0.0.0.0`)
- `API_KEY`
- `WEBHOOK_URL`
- `WEBHOOK_SECRET`
- `RATE_LIMIT_MAX`
- `RATE_LIMIT_WINDOW_MS`

# auth.js

O `src/security/auth.js` implementa um middleware simples de API Key:
- le o header `Authorization: Bearer <API_KEY>`;
- compara com `config.apiKey`;
- retorna `401` se estiver invalido;
- chama `done()` quando esta autorizado.

# app.js

O `src/app.js` e o ponto de entrada da aplicacao:
- inicia o servidor Fastify;
- aplica rate limit;
- registra as rotas;
- valida a `API_KEY` com `requireApiKey()`;
- abre o servidor em `config.host:config.port`.

# Painel Web

O painel fica em `public/` e e servido pelo Fastify em `http://localhost:3000`.

Ele usa os endpoints:
- `GET /status` para mostrar status e QR.
- `POST /webhook` para enviar a configuracao do n8n.

Se voce ainda nao implementou esses endpoints, o painel ainda abre, mas vai mostrar placeholders.

# session.js

O `src/whatsapp/session.js` define onde a sessao do WhatsApp fica salva:
- cria o caminho absoluto para a pasta `sessions/`;
- usa `useMultiFileAuthState` para persistir credenciais do Baileys;
- exporta `loadAuthState()` para ser usado pelo cliente.

# Webhook persistente

O webhook configurado no painel agora e salvo em `data/webhook.json`.
Ao reiniciar o servidor, o arquivo e carregado e as configuracoes continuam.
