import { authMiddleware } from '../security/auth.js';
import { disconnectWhatsApp, getSessionStatus, initWhatsApp } from '../whatsapp/client.js';

export default async function statusRoutes(app) {
    app.get('/status', { preHandler: authMiddleware }, async () => {
        await initWhatsApp();
        return getSessionStatus();
    });

    app.post('/session/disconnect', { preHandler: authMiddleware }, async (req) => {
        const { reset } = req.body || {};
        return disconnectWhatsApp({ reset: reset !== false });
    });
}
