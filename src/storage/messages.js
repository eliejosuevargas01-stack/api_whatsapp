import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', '..', 'data');
const dataFile = path.join(dataDir, 'messages.json');
const tempFile = `${dataFile}.tmp`;
let storeQueue = Promise.resolve();

async function ensureStore() {
    await fs.mkdir(dataDir, { recursive: true });
    try {
        await fs.access(dataFile);
    } catch {
        await fs.writeFile(dataFile, JSON.stringify({ messages: [] }, null, 2));
    }
}

async function readStore() {
    await ensureStore();
    const raw = await fs.readFile(dataFile, 'utf-8');
    if (!raw) {
        return { messages: [] };
    }
    try {
        return JSON.parse(raw);
    } catch {
        const recovered = recoverStore(raw);
        await backupCorruptStore(raw);
        if (recovered) {
            await writeStore(recovered);
            return recovered;
        }
        return { messages: [] };
    }
}

async function writeStore(store) {
    const payload = JSON.stringify(store, null, 2);
    await fs.writeFile(tempFile, payload);
    await fs.rename(tempFile, dataFile);
}

export function extractText(message) {
    const msg = message?.message || {};
    return msg.conversation
        || msg.extendedTextMessage?.text
        || msg.buttonsResponseMessage?.selectedDisplayText
        || msg.buttonsResponseMessage?.selectedButtonId
        || msg.templateButtonReplyMessage?.selectedDisplayText
        || msg.templateButtonReplyMessage?.selectedId
        || msg.listResponseMessage?.title
        || msg.listResponseMessage?.singleSelectReply?.selectedRowId
        || msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
        || '';
}

export async function storeIncomingMessage(message, { jid, conversationId } = {}) {
    await withStoreLock(async () => {
        const store = await readStore();
        const id = message?.key?.id || String(Date.now());
        if (store.messages.some((item) => item.id === id)) {
            return;
        }
        store.messages.push({
            id,
            jid: jid || message?.key?.remoteJid || '',
            conversationId: conversationId || '',
            fromMe: false,
            text: extractText(message),
            timestamp: Number(message?.messageTimestamp) || Math.floor(Date.now() / 1000),
            type: 'text',
        });
        await writeStore(store);
    });
}

export async function storeOutgoingMessage({ jid, text, id, conversationId, type = 'text', poll = null }) {
    await withStoreLock(async () => {
        const store = await readStore();
        const messageId = id || String(Date.now());
        if (store.messages.some((item) => item.id === messageId)) {
            return;
        }
        store.messages.push({
            id: messageId,
            jid,
            conversationId: conversationId || '',
            fromMe: true,
            text,
            timestamp: Math.floor(Date.now() / 1000),
            type,
            poll,
        });
        await writeStore(store);
    });
}

function withStoreLock(task) {
    const next = storeQueue.then(task, task);
    storeQueue = next.catch(() => {});
    return next;
}

function recoverStore(raw) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) {
        return null;
    }
    const slice = raw.slice(start, end + 1);
    try {
        return JSON.parse(slice);
    } catch {
        return null;
    }
}

async function backupCorruptStore(raw) {
    const backup = `${dataFile}.corrupt-${Date.now()}`;
    await fs.writeFile(backup, raw);
}

export async function listConversations() {
    const store = await readStore();
    const byJid = new Map();

    for (const message of store.messages) {
        const key = message.conversationId || message.jid;
        const existing = byJid.get(key);
        if (!existing || message.timestamp >= existing.lastTimestamp) {
            byJid.set(key, {
                jid: key,
                lastMessage: message.text,
                lastTimestamp: message.timestamp,
            });
        }
    }

    return Array.from(byJid.values()).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
}

export async function getMessagesByJid(jid) {
    const store = await readStore();
    return store.messages
        .filter((message) => message.jid === jid)
        .sort((a, b) => a.timestamp - b.timestamp);
}

export async function getRecentMessagesByJid(jid, limit = 20) {
    const messages = await getMessagesByJid(jid);
    if (messages.length <= limit) {
        return messages;
    }
    return messages.slice(-limit);
}

export async function getRecentMessagesByConversationId(conversationId, limit = 20) {
    const store = await readStore();
    const filtered = store.messages
        .filter((message) => message.conversationId === conversationId)
        .sort((a, b) => a.timestamp - b.timestamp);
    if (filtered.length <= limit) {
        return filtered;
    }
    return filtered.slice(-limit);
}

export async function getLastOutgoingMessageByConversationId(conversationId) {
    const store = await readStore();
    const outgoing = store.messages
        .filter((message) => message.conversationId === conversationId && message.fromMe)
        .sort((a, b) => a.timestamp - b.timestamp);
    return outgoing.length ? outgoing[outgoing.length - 1] : null;
}

export async function getMessageById(id) {
    if (!id) return null;
    const store = await readStore();
    return store.messages.find((message) => message.id === id) || null;
}

export async function updateMessageById(id, patch) {
    if (!id || !patch) return null;
    return withStoreLock(async () => {
        const store = await readStore();
        const index = store.messages.findIndex((message) => message.id === id);
        if (index === -1) return null;
        store.messages[index] = {
            ...store.messages[index],
            ...patch,
        };
        await writeStore(store);
        return store.messages[index];
    });
}
