import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, requireApiKey } from './config.js';
import statusRoutes from './routes/status.js';
import sendMessageRoutes from './routes/send-message.js';
import webhookRoutes from './routes/webhook.js';
import conversationRoutes from './routes/conversations.js';

requireApiKey();

const app = Fastify({
    logger: true,
});

app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body) {
        done(null, {});
        return;
    }
    try {
        done(null, JSON.parse(body));
    } catch (err) {
        done(err);
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
});

await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    index: ['index.html'],
});

app.get('/health', async () => ({ ok: true }));

await app.register(statusRoutes);
await app.register(sendMessageRoutes);
await app.register(webhookRoutes);
await app.register(conversationRoutes);

app.listen({ port: config.port, host: config.host });
