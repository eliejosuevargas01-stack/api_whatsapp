# API WhatsApp

Aplicacao unica com:

- API Fastify em `/api/*`
- painel local simples em `/`
- multiplas sessoes/dispositivos de WhatsApp
- QR Code por sessao
- historico de conversas por sessao

## Requisitos

- Node.js 20+
- pasta persistente para `sessions/`
- pasta persistente para `data/`

## Variaveis de ambiente

Use `.env.example` como base:

- `PORT`
- `HOST`
- `RATE_LIMIT_MAX`
- `RATE_LIMIT_WINDOW`
- `BODY_LIMIT_MB`
- `AUTO_CONNECT`
- `SYNC_FULL_HISTORY`
- `SESSIONS_DIR`
- `DATA_DIR`
- `MEDIA_DIR`
- `MAX_STORED_MESSAGES` (`0` = sem limite)
- `LOG_LEVEL`

## Rodando localmente

```bash
npm install
cp .env.example .env
npm run dev
```

Abra `http://localhost:3000`.

## Estrutura de dados

- `sessions/`: autenticacao do WhatsApp por sessao
- `data/sessions.json`: metadados das sessoes
- `data/conversations.json`: resumo das conversas por sessao
- `data/messages.json`: historico de mensagens por sessao
- `data/media/`: cache local de imagens, videos, audios, stickers e documentos

## Endpoints principais

- `GET /api/health`
- `GET /api/bootstrap`
- `GET /api/status`
- `GET /api/sessions`
- `POST /api/sessions`
- `GET /api/sessions/:sessionId`
- `POST /api/sessions/:sessionId/connect`
- `POST /api/sessions/:sessionId/disconnect`
- `POST /api/sessions/:sessionId/logout`
- `GET /api/sessions/:sessionId/conversations`
- `GET /api/sessions/:sessionId/conversations/:jid/messages`
- `POST /api/sessions/:sessionId/conversations/:jid/read`
- `POST /api/sessions/:sessionId/messages/send`
