import { authMiddleware } from '../security/auth.js';
import { initWhatsApp } from '../whatsapp/client.js';
import { storeOutgoingMessage } from '../storage/messages.js';
import { linkJids, resolveConversationJid } from '../storage/conversations.js';

function normalizeJid(input) {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    const hasDomain = trimmed.includes('@');
    const digits = trimmed.replace(/\D/g, '');

    if (trimmed.includes('@g.us') || trimmed.includes('@lid')) {
        return trimmed;
    }
    if (!digits) return null;

    let normalizedDigits = digits;
    if (digits.startsWith('55') && digits.length === 13 && digits[4] === '9') {
        // Remove extra 9 after DDD for BR numbers (55 + DDD + 9 + 8 digits).
        normalizedDigits = `${digits.slice(0, 4)}${digits.slice(5)}`;
    }
    if (!hasDomain || trimmed.includes('@s.whatsapp.net')) {
        return `${normalizedDigits}@s.whatsapp.net`;
    }
    return trimmed;
}

export default async function sendMessageRoutes(app) {
    app.post('/messages/send', { preHandler: authMiddleware }, async (req, reply) => {
        const { to, message, conversationJid, conversationId } = req.body || {};
        const resolvedJid = conversationId ? await resolveConversationJid(conversationId) : null;
        const jid = normalizeJid(to) || normalizeJid(resolvedJid);
        const contextJid = conversationJid ? normalizeJid(conversationJid) : null;

        if (!jid) {
            reply.code(400).send({ error: 'Invalid recipient' });
            return;
        }

        if (conversationJid && !contextJid) {
            reply.code(400).send({ error: 'Invalid conversationJid' });
            return;
        }

        if (!message || typeof message !== 'string') {
            reply.code(400).send({ error: 'Invalid message' });
            return;
        }

        const socket = await initWhatsApp();
        const result = await socket.sendMessage(jid, { text: message });
        const linkedConversationId = await linkJids(
            [contextJid || jid],
            conversationId || null,
        );
        await storeOutgoingMessage({
            jid: contextJid || jid,
            text: message,
            id: result?.key?.id,
            conversationId: linkedConversationId,
        });

        reply.send({ ok: true, result, conversationId: linkedConversationId });
    });

    app.post('/messages/send-buttons', { preHandler: authMiddleware }, async (req, reply) => {
        const { to, message, buttons, footer, conversationJid, conversationId } = req.body || {};
        const resolvedJid = conversationId ? await resolveConversationJid(conversationId) : null;
        const jid = normalizeJid(to) || normalizeJid(resolvedJid);
        const contextJid = conversationJid ? normalizeJid(conversationJid) : null;

        if (!jid) {
            reply.code(400).send({ error: 'Invalid recipient' });
            return;
        }

        if (conversationJid && !contextJid) {
            reply.code(400).send({ error: 'Invalid conversationJid' });
            return;
        }

        if (!message || typeof message !== 'string') {
            reply.code(400).send({ error: 'Invalid message' });
            return;
        }

        if (!Array.isArray(buttons) || buttons.length === 0) {
            reply.code(400).send({ error: 'Buttons are required' });
            return;
        }

        const normalizedButtons = buttons
            .map((button, index) => {
                if (typeof button === 'string') {
                    return {
                        buttonId: `btn_${index + 1}`,
                        buttonText: { displayText: button },
                        type: 1,
                    };
                }
                if (button && typeof button === 'object') {
                    const text = String(button.text || button.label || '').trim();
                    if (!text) return null;
                    return {
                        buttonId: String(button.id || `btn_${index + 1}`),
                        buttonText: { displayText: text },
                        type: 1,
                    };
                }
                return null;
            })
            .filter(Boolean);

        if (!normalizedButtons.length) {
            reply.code(400).send({ error: 'Buttons are invalid' });
            return;
        }

        const socket = await initWhatsApp();
        const result = await socket.sendMessage(jid, {
            text: message,
            footer: typeof footer === 'string' ? footer : undefined,
            buttons: normalizedButtons,
            headerType: 1,
        });

        const linkedConversationId = await linkJids(
            [contextJid || jid],
            conversationId || null,
        );
        await storeOutgoingMessage({
            jid: contextJid || jid,
            text: message,
            id: result?.key?.id,
            conversationId: linkedConversationId,
        });

        reply.send({ ok: true, result, conversationId: linkedConversationId });
    });

    app.post('/messages/send-list', { preHandler: authMiddleware }, async (req, reply) => {
        const { to, title, message, buttonText, sections, footer, conversationJid, conversationId } = req.body || {};
        const resolvedJid = conversationId ? await resolveConversationJid(conversationId) : null;
        const jid = normalizeJid(to) || normalizeJid(resolvedJid);
        const contextJid = conversationJid ? normalizeJid(conversationJid) : null;

        if (!jid) {
            reply.code(400).send({ error: 'Invalid recipient' });
            return;
        }

        if (conversationJid && !contextJid) {
            reply.code(400).send({ error: 'Invalid conversationJid' });
            return;
        }

        if (!message || typeof message !== 'string') {
            reply.code(400).send({ error: 'Invalid message' });
            return;
        }

        if (!buttonText || typeof buttonText !== 'string') {
            reply.code(400).send({ error: 'Invalid buttonText' });
            return;
        }

        if (!Array.isArray(sections) || sections.length === 0) {
            reply.code(400).send({ error: 'Sections are required' });
            return;
        }

        const normalizedSections = sections
            .map((section, index) => {
                const sectionTitle = String(section?.title || `Opcoes ${index + 1}`).trim();
                const rows = Array.isArray(section?.rows) ? section.rows : [];
                const normalizedRows = rows
                    .map((row, rowIndex) => {
                        const rowTitle = String(row?.title || row?.label || '').trim();
                        if (!rowTitle) return null;
                        return {
                            title: rowTitle,
                            rowId: String(row?.id || `row_${index + 1}_${rowIndex + 1}`),
                            description: typeof row?.description === 'string' ? row.description : undefined,
                        };
                    })
                    .filter(Boolean);
                if (!normalizedRows.length) return null;
                return { title: sectionTitle, rows: normalizedRows };
            })
            .filter(Boolean);

        if (!normalizedSections.length) {
            reply.code(400).send({ error: 'Sections are invalid' });
            return;
        }

        const socket = await initWhatsApp();
        const result = await socket.sendMessage(jid, {
            text: message,
            footer: typeof footer === 'string' ? footer : undefined,
            title: typeof title === 'string' ? title : undefined,
            buttonText,
            sections: normalizedSections,
        });

        const linkedConversationId = await linkJids(
            [contextJid || jid],
            conversationId || null,
        );
        await storeOutgoingMessage({
            jid: contextJid || jid,
            text: message,
            id: result?.key?.id,
            conversationId: linkedConversationId,
        });

        reply.send({ ok: true, result, conversationId: linkedConversationId });
    });

    app.post('/messages/send-poll', { preHandler: authMiddleware }, async (req, reply) => {
        const { to, question, options, selectableCount, conversationJid, conversationId } = req.body || {};
        const resolvedJid = conversationId ? await resolveConversationJid(conversationId) : null;
        const jid = normalizeJid(to) || normalizeJid(resolvedJid);
        const contextJid = conversationJid ? normalizeJid(conversationJid) : null;

        if (!jid) {
            reply.code(400).send({ error: 'Invalid recipient' });
            return;
        }

        if (conversationJid && !contextJid) {
            reply.code(400).send({ error: 'Invalid conversationJid' });
            return;
        }

        if (!question || typeof question !== 'string') {
            reply.code(400).send({ error: 'Invalid question' });
            return;
        }

        if (!Array.isArray(options) || options.length < 2) {
            reply.code(400).send({ error: 'Options must contain at least 2 items' });
            return;
        }

        const normalizedOptions = options
            .map((option) => String(option || '').trim())
            .filter(Boolean);

        if (normalizedOptions.length < 2) {
            reply.code(400).send({ error: 'Options are invalid' });
            return;
        }

        const maxSelectable = Number.isFinite(Number(selectableCount))
            ? Math.max(1, Math.min(normalizedOptions.length, Number(selectableCount)))
            : 1;

        const socket = await initWhatsApp();
        const result = await socket.sendMessage(jid, {
            poll: {
                name: question,
                values: normalizedOptions,
                selectableCount: maxSelectable,
            },
        });
        const messageSecret = result?.message?.pollCreationMessageV3?.messageSecret
            || result?.message?.pollCreationMessage?.contextInfo?.messageSecret
            || result?.message?.messageContextInfo?.messageSecret;
        const encKey = result?.message?.pollCreationMessage?.encKey
            || result?.message?.pollCreationMessageV3?.encKey;
        const creatorJid = socket?.user?.id || '';
        const toBase64 = (value) => {
            if (!value) return null;
            if (typeof value === 'string') return value;
            if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
                return Buffer.from(value).toString('base64');
            }
            return null;
        };
        console.log('Poll creation debug', {
            pollId: result?.key?.id || '',
            hasMessageSecret: !!messageSecret,
            hasEncKey: !!encKey,
            creatorJid,
        });

        const linkedConversationId = await linkJids(
            [contextJid || jid],
            conversationId || null,
        );
        await storeOutgoingMessage({
            jid: contextJid || jid,
            text: question,
            id: result?.key?.id,
            type: 'poll',
            poll: {
                name: question,
                options: normalizedOptions,
                selectableCount: maxSelectable,
                messageSecret: toBase64(messageSecret),
                encKey: toBase64(encKey),
                creatorJid,
            },
            conversationId: linkedConversationId,
        });

        reply.send({ ok: true, result, conversationId: linkedConversationId });
    });
}
