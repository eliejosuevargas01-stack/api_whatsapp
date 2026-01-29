import { config } from '../config.js';
import { extractText, getLastOutgoingMessageByConversationId, getMessageById, getRecentMessagesByConversationId, storeIncomingMessage, storeOutgoingMessage, updateMessageById } from '../storage/messages.js';
import { findConversationIdByJid, getLinkedJidsForConversationId, linkJids } from '../storage/conversations.js';
import { getAggregateVotesInPollMessage, jidDecode, jidNormalizedUser } from '@whiskeysockets/baileys';
import { decryptPollVote } from '@whiskeysockets/baileys/lib/Utils/process-message.js';

function decodeJid(jid) {
    if (!jid || typeof jid !== 'string') return '';
    const decoded = jidDecode(jid);
    if (decoded?.user && decoded?.server) {
        return `${decoded.user}@${decoded.server}`;
    }
    return jid;
}

function getSenderJid(message) {
    const participant = message?.key?.participant || '';
    const remoteJid = message?.key?.remoteJid || '';

    if (participant) return decodeJid(participant);
    return decodeJid(remoteJid);
}

function getAltRemoteJid(message) {
    const addressingMode = message?.key?.addressingMode;
    const remoteJidAlt = message?.key?.remoteJidAlt || '';
    if (addressingMode === 'lid' && remoteJidAlt) {
        return decodeJid(remoteJidAlt);
    }
    return '';
}

function getAltParticipantJid(message) {
    const addressingMode = message?.key?.addressingMode;
    const participantAlt = message?.key?.participantAlt || '';
    if (addressingMode === 'lid' && participantAlt) {
        return decodeJid(participantAlt);
    }
    return '';
}

function getPhoneJidFromKey(message) {
    const senderPn = message?.key?.senderPn || '';
    const participantPn = message?.key?.participantPn || '';
    const candidate = senderPn || participantPn;
    if (!candidate) return '';
    const digits = String(candidate).replace(/\D/g, '');
    return digits ? `${digits}@s.whatsapp.net` : '';
}

function getConversationJid(message) {
    const candidates = [
        getPhoneJidFromKey(message),
        message?.key?.remoteJidAlt,
        message?.key?.participantAlt,
        message?.key?.participant,
        message?.key?.remoteJid,
        getSenderJid(message),
        getAltRemoteJid(message),
        getAltParticipantJid(message),
    ]
        .map((jid) => decodeJid(jid || ''))
        .filter(Boolean);

    const seen = new Set();
    const unique = candidates.filter((jid) => {
        if (seen.has(jid)) return false;
        seen.add(jid);
        return true;
    });

    const phoneJid = unique.find((jid) => jid.endsWith('@s.whatsapp.net'));
    if (phoneJid) return phoneJid;

    const groupJid = unique.find((jid) => jid.endsWith('@g.us'));
    if (groupJid) return groupJid;

    return unique[0] || '';
}

function buildMessagePayload(message) {
    const text = extractText(message);
    const remoteJidRaw = decodeJid(message?.key?.remoteJid || '');
    const remoteJidAlt = getAltRemoteJid(message);
    const senderJid = getSenderJid(message);
    const senderJidAlt = getAltParticipantJid(message);
    const conversationJid = getConversationJid(message);
    const senderPnJid = getPhoneJidFromKey(message);
    const remoteJid = conversationJid && (conversationJid.endsWith('@s.whatsapp.net') || conversationJid.endsWith('@g.us'))
        ? conversationJid
        : remoteJidRaw;

    return {
        from: senderJid || remoteJid,
        remoteJid,
        remoteJidRaw,
        remoteJidAlt,
        senderJid,
        senderJidAlt,
        senderPnJid,
        conversationJid,
        addressingMode: message?.key?.addressingMode || '',
        isGroup: remoteJid.endsWith('@g.us'),
        pushName: message?.pushName || '',
        messageId: message?.key?.id || '',
        message: text,
        timestamp: message?.messageTimestamp || null,
    };
}

function getQuotedMessageId(message) {
    const msg = message?.message || {};
    return msg.extendedTextMessage?.contextInfo?.stanzaId
        || msg.buttonsResponseMessage?.contextInfo?.stanzaId
        || msg.templateButtonReplyMessage?.contextInfo?.stanzaId
        || msg.listResponseMessage?.contextInfo?.stanzaId
        || msg.interactiveResponseMessage?.contextInfo?.stanzaId
        || '';
}

function buildPollWebhookPayload({ message, pollMessage, conversationId }) {
    const pollUpdate = message?.message?.pollUpdateMessage;
    const pollKey = pollUpdate?.pollCreationMessageKey;
    const pollId = pollKey?.id || '';
    const pollName = pollMessage?.poll?.name || '';
    const pollOptions = pollMessage?.poll?.options || [];
    const voterJid = decodeJid(message?.key?.participant || message?.key?.remoteJid || '');
    const pollEncKey = pollMessage?.poll?.messageSecret
        ? Buffer.from(pollMessage.poll.messageSecret, 'base64')
        : pollMessage?.poll?.encKey
            ? Buffer.from(pollMessage.poll.encKey, 'base64')
            : null;
    const pollCreatorJidRaw = decodeJid(pollKey?.remoteJid || '')
        || pollMessage?.poll?.creatorJid
        || pollMessage?.jid
        || '';
    const pollCreatorJid = jidNormalizedUser(pollCreatorJidRaw);
    const normalizedVoterJid = jidNormalizedUser(voterJid);

    let selectedOptions = [];
    if (pollOptions.length && pollUpdate && pollEncKey) {
        try {
            console.log('Poll decrypt input', {
                pollId,
                pollCreatorJid,
                voterJid: normalizedVoterJid,
                hasPollEncKey: !!pollEncKey,
            });
            let vote = null;
            try {
                vote = decryptPollVote(
                    pollUpdate.vote,
                    {
                        pollEncKey,
                        pollCreatorJid,
                        pollMsgId: pollId,
                        voterJid: normalizedVoterJid,
                    },
                );
                console.log('Poll decrypt vote', JSON.stringify(vote, null, 2));
            } catch (err) {
                console.error('Poll decrypt error', err?.message || String(err));
            }
            if (!vote) {
                return {
                    event: 'poll_update',
                    pollId,
                    pollName,
                    pollOptions,
                    selectedOptions,
                    voterJid,
                    remoteJid: pollMessage?.jid || decodeJid(pollKey?.remoteJid || message?.key?.remoteJid || ''),
                    conversationId: conversationId || pollMessage?.conversationId || '',
                    messageId: message?.key?.id || '',
                    timestamp: message?.messageTimestamp || null,
                    rawVote: pollUpdate?.vote || null,
                };
            }
            const aggregate = getAggregateVotesInPollMessage({
                message: {
                    pollCreationMessage: {
                        name: pollName,
                        options: pollOptions.map((optionName) => ({ optionName })),
                    },
                },
                pollUpdates: [{
                    pollUpdateMessageKey: message?.key || {},
                    vote,
                    senderTimestampMs: Number(pollUpdate?.senderTimestampMs) || Date.now(),
                }],
            });
            selectedOptions = aggregate
                .filter((option) => option.voters && option.voters.length)
                .map((option) => option.name);
        } catch {
            selectedOptions = [];
        }
    }

    return {
        event: 'poll_update',
        pollId,
        pollName,
        pollOptions,
        selectedOptions,
        voterJid,
        remoteJid: pollMessage?.jid || decodeJid(pollKey?.remoteJid || message?.key?.remoteJid || ''),
        conversationId: conversationId || pollMessage?.conversationId || '',
        messageId: message?.key?.id || '',
        timestamp: message?.messageTimestamp || null,
        rawVote: pollUpdate?.vote || null,
    };
}

function extractPollSecrets(message) {
    const poll = message?.message || {};
    const primary = poll.pollCreationMessage || poll.pollCreationMessageV2 || poll.pollCreationMessageV3 || {};
    const v3 = poll.pollCreationMessageV3 || {};
    return {
        messageSecret: v3?.messageSecret
            || primary?.contextInfo?.messageSecret
            || poll.messageContextInfo?.messageSecret
            || null,
        encKey: primary?.encKey || v3?.encKey || null,
    };
}

async function postWebhook(payload) {
    if (!config.webhookUrl) return;

    const headers = { 'Content-Type': 'application/json' };
    if (config.webhookSecret) {
        headers['X-Webhook-Secret'] = config.webhookSecret;
    }

    try {
        const response = await fetch(config.webhookUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            console.error('Webhook post failed', response.status, text);
        }
    } catch (err) {
        console.error('Webhook post error', err?.message || String(err));
    }
}

function shouldSendToWebhook(jid) {
    const isGroup = typeof jid === 'string' && jid.endsWith('@g.us');
    const isNewsletter = typeof jid === 'string' && jid.endsWith('@newsletter');
    const isBroadcast = typeof jid === 'string' && jid.endsWith('@broadcast');

    if (isNewsletter || isBroadcast) {
        return false;
    }

    if (config.webhookFilterMode === 'contacts_only') {
        return !isGroup;
    }

    if (config.webhookFilterMode === 'groups_allowlist') {
        if (!isGroup) return false;
        return config.webhookGroupAllowlist.includes(jid);
    }

    return true;
}

export function registerEvents(socket, getState) {
    const sentWebhookIds = new Map();

    function shouldSkipWebhook(messageId) {
        if (!messageId) return false;
        const now = Date.now();
        for (const [id, ts] of sentWebhookIds) {
            if (now - ts > 5 * 60 * 1000) {
                sentWebhookIds.delete(id);
            }
        }
        if (sentWebhookIds.has(messageId)) {
            return true;
        }
        sentWebhookIds.set(messageId, now);
        return false;
    }
    function extractContactJids(contact) {
        if (!contact) return [];
        const jids = [];
        if (typeof contact.id === 'string') jids.push(contact.id);
        if (typeof contact.jid === 'string') jids.push(contact.jid);
        if (typeof contact.lid === 'string') jids.push(contact.lid);
        return jids;
    }

    socket.ev.on('contacts.upsert', async (contacts) => {
        try {
            for (const contact of contacts || []) {
                const jids = extractContactJids(contact);
                if (jids.length) {
                    await linkJids(jids);
                }
            }
        } catch (err) {
            console.error('Contact link error:', err?.message || String(err));
        }
    });

    socket.ev.on('messaging-history.set', async (event) => {
        try {
            for (const contact of event?.contacts || []) {
                const jids = extractContactJids(contact);
                if (jids.length) {
                    await linkJids(jids);
                }
            }
        } catch (err) {
            console.error('Contact link error:', err?.message || String(err));
        }
    });

    socket.ev.on('contacts.update', async (contacts) => {
        try {
            for (const contact of contacts || []) {
                const jids = extractContactJids(contact);
                if (jids.length) {
                    await linkJids(jids);
                }
            }
        } catch (err) {
            console.error('Contact link error:', err?.message || String(err));
        }
    });

    socket.ev.on('chats.phoneNumberShare', async (event) => {
        try {
            if (event?.jid && event?.lid) {
                await linkJids([event.jid, event.lid]);
            }
        } catch (err) {
            console.error('Contact link error:', err?.message || String(err));
        }
    });

    socket.ev.on('messages.upsert', async (event) => {
        const message = event?.messages?.[0];
        if (!message) return;

        const fromMe = !!message.key?.fromMe;
        if (fromMe && (message?.message?.pollCreationMessage || message?.message?.pollCreationMessageV2 || message?.message?.pollCreationMessageV3) && message.key?.id) {
            const { messageSecret, encKey } = extractPollSecrets(message);
            if (messageSecret || encKey) {
                await updateMessageById(message.key.id, {
                    poll: {
                        ...(await getMessageById(message.key.id))?.poll,
                        messageSecret: messageSecret ? Buffer.from(messageSecret).toString('base64') : null,
                        encKey: encKey ? Buffer.from(encKey).toString('base64') : null,
                    },
                });
            }
        }
        if (message?.message?.pollUpdateMessage) {
            console.log('Poll update (upsert):', JSON.stringify(message?.message?.pollUpdateMessage || {}, null, 2));
            try {
                const pollKey = message?.message?.pollUpdateMessage?.pollCreationMessageKey;
                const pollMessageId = pollKey?.id || '';
                const pollMessage = pollMessageId ? await getMessageById(pollMessageId) : null;
                const conversationId = await linkJids([
                    pollMessage?.conversationId,
                    pollMessage?.jid,
                    decodeJid(pollKey?.remoteJid || ''),
                ]);
                const payload = buildPollWebhookPayload({ message, pollMessage, conversationId });
                if (payload.messageId && shouldSkipWebhook(payload.messageId)) {
                    return;
                }
                console.log('Poll webhook payload:', JSON.stringify(payload, null, 2));
                if (shouldSendToWebhook(payload.remoteJid)) {
                    await postWebhook(payload);
                }
            } catch (err) {
                console.error('Poll webhook error:', err?.message || String(err));
            }
            return;
        }

        const conversationJid = getConversationJid(message);
        const payload = {
            ...buildMessagePayload(message),
            session: getState().status,
            fromMe,
        };

        try {
            if (payload.senderPnJid && payload.senderJid?.endsWith('@lid')) {
                const existingId = await findConversationIdByJid(payload.senderJid);
                if (existingId) {
                    await linkJids([payload.senderPnJid, payload.senderJid], existingId);
                }
            }
            const quotedId = getQuotedMessageId(message);
            const quotedMessage = quotedId ? await getMessageById(quotedId) : null;
            const primaryJid = quotedMessage?.jid || conversationJid;
            const linkedIds = quotedMessage?.conversationId
                ? await getLinkedJidsForConversationId(quotedMessage.conversationId)
                : [];
            const conversationId = await linkJids([
                quotedMessage?.conversationId,
                ...linkedIds,
                primaryJid,
                conversationJid,
                payload.senderPnJid,
                payload.remoteJid,
                payload.remoteJidRaw,
                payload.remoteJidAlt,
                payload.senderJid,
                payload.senderJidAlt,
            ]);
            payload.conversationId = conversationId;
            if (fromMe) {
                await storeOutgoingMessage({
                    jid: conversationJid,
                    text: payload.message || '',
                    id: payload.messageId,
                    conversationId,
                });
                return;
            }

            await storeIncomingMessage(message, { jid: conversationJid, conversationId });
            if (conversationId) {
                payload.lastBotMessage = quotedMessage?.fromMe
                    ? quotedMessage
                    : await getLastOutgoingMessageByConversationId(conversationId);
                payload.conversation = await getRecentMessagesByConversationId(conversationId, 2);
            }
            const hasBotContext = payload.lastBotMessage && payload.lastBotMessage.text;
            const hasUserText = typeof payload.message === 'string' && payload.message.trim().length > 0;
            const botPhoneJid = payload.lastBotMessage?.jid || '';
            if (botPhoneJid.endsWith('@s.whatsapp.net') && !payload.remoteJid.endsWith('@s.whatsapp.net')) {
                payload.remoteJid = botPhoneJid;
            }
            if (!hasUserText || shouldSkipWebhook(payload.messageId)) {
                return;
            }
            if (shouldSendToWebhook(message?.key?.remoteJid)) {
                await postWebhook(payload);
            }
        } catch (err) {
            console.error('Webhook error:', err?.message || String(err));
        }
    });

    socket.ev.on('messages.update', async (updates) => {
        for (const update of updates || []) {
            const message = update;
            if (!message?.message?.pollUpdateMessage) {
                continue;
            }
            console.log('Poll update (update):', JSON.stringify(message?.message?.pollUpdateMessage || {}, null, 2));
            try {
                const pollKey = message?.message?.pollUpdateMessage?.pollCreationMessageKey;
                const pollMessageId = pollKey?.id || '';
                const pollMessage = pollMessageId ? await getMessageById(pollMessageId) : null;
                const conversationId = await linkJids([
                    pollMessage?.conversationId,
                    pollMessage?.jid,
                    decodeJid(pollKey?.remoteJid || ''),
                ]);
                const payload = buildPollWebhookPayload({ message, pollMessage, conversationId });
                if (payload.messageId && shouldSkipWebhook(payload.messageId)) {
                    continue;
                }
                console.log('Poll webhook payload:', JSON.stringify(payload, null, 2));
                if (shouldSendToWebhook(payload.remoteJid)) {
                    await postWebhook(payload);
                }
            } catch (err) {
                console.error('Poll webhook error:', err?.message || String(err));
            }
        }
    });
}
