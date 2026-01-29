import { authMiddleware } from '../security/auth.js';
import { updateWebhookConfig } from '../config.js';

export default async function webhookRoutes(app) {
    app.post('/webhook', { preHandler: authMiddleware }, async (req, reply) => {
        const {
            webhookUrl,
            webhookSecret,
            webhookFilterMode,
            webhookGroupAllowlist,
            webhookIgnoreFromMe,
        } = req.body || {};

        updateWebhookConfig({
            webhookUrl: typeof webhookUrl === 'string' ? webhookUrl.trim() : '',
            webhookSecret: typeof webhookSecret === 'string' ? webhookSecret.trim() : '',
            webhookFilterMode: typeof webhookFilterMode === 'string' ? webhookFilterMode : undefined,
            webhookGroupAllowlist,
            webhookIgnoreFromMe: typeof webhookIgnoreFromMe === 'boolean' ? webhookIgnoreFromMe : undefined,
        });

        reply.send({ ok: true });
    });
}
