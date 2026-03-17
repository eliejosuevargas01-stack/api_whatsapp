# API WhatsApp

Aplicacao unica para deploy no Coolify com:

- API Fastify em `/api/*`
- painel web servido em `/`
- sessao do WhatsApp persistida em `sessions/`
- historico e configuracoes persistidos em `data/`

## Requisitos

- Node.js 20+
- variaveis de ambiente definidas
- volume persistente para `sessions/` e `data/` em producao

## Variaveis de ambiente

Use o `.env.example` como base:

- `PORT`
- `HOST`
- `API_KEY`
- `WEBHOOK_URL`
- `WEBHOOK_SECRET`
- `RATE_LIMIT_MAX`
- `RATE_LIMIT_WINDOW`
- `AUTO_CONNECT`
- `SESSIONS_DIR`
- `DATA_DIR`
- `LOG_LEVEL`

## Rodando localmente

```bash
npm install
cp .env.example .env
npm run dev
```

Abra `http://localhost:3000`.

## Deploy no Coolify

Use `Dockerfile` na raiz do projeto.

No Coolify:

1. Crie uma `Application` apontando para este repositório.
2. Escolha o build pack `Dockerfile`.
3. Configure as variaveis do `.env.example`.
4. Monte volumes persistentes para:
   - `/app/sessions`
   - `/app/data`
5. Defina health check em `/api/health`.

## Endpoints principais

- `GET /api/health`
- `GET /api/status`
- `POST /api/whatsapp/connect`
- `POST /api/whatsapp/disconnect`
- `POST /api/whatsapp/logout`
- `GET /api/conversations`
- `GET /api/conversations/:id`
- `POST /api/messages/send`
- `GET /api/webhook`
- `PUT /api/webhook`
