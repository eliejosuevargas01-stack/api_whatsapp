import { authMiddleware } from '../security/auth.js';
import { getMessagesByJid, listConversations } from '../storage/messages.js';

export default async function conversationRoutes(app) {
    app.get('/conversations', { preHandler: authMiddleware }, async () => {
        const conversations = await listConversations();
        return { conversations };
    });

    app.get('/conversations/:jid/messages', { preHandler: authMiddleware }, async (req, reply) => {
        const { jid } = req.params || {};
        if (!jid) {
            reply.code(400).send({ error: 'Missing jid' });
            return;
        }

        const messages = await getMessagesByJid(jid);
        reply.send({ messages });
    });
}
