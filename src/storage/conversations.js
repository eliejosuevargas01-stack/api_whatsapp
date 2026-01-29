import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', '..', 'data');
const dataFile = path.join(dataDir, 'conversations.json');
const tempFile = `${dataFile}.tmp`;
let storeQueue = Promise.resolve();

function createStore() {
    return {
        jidToConversationId: {},
        conversations: {},
    };
}

async function ensureStore() {
    await fs.mkdir(dataDir, { recursive: true });
    try {
        await fs.access(dataFile);
    } catch {
        await fs.writeFile(dataFile, JSON.stringify(createStore(), null, 2));
    }
}

async function readStore() {
    await ensureStore();
    const raw = await fs.readFile(dataFile, 'utf-8');
    if (!raw) return createStore();
    try {
        return JSON.parse(raw);
    } catch {
        const fallback = createStore();
        await writeStore(fallback);
        return fallback;
    }
}

async function writeStore(store) {
    const payload = JSON.stringify(store, null, 2);
    await fs.writeFile(tempFile, payload);
    await fs.rename(tempFile, dataFile);
}

function withStoreLock(task) {
    const next = storeQueue.then(task, task);
    storeQueue = next.catch(() => {});
    return next;
}

function generateConversationId() {
    return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeJid(jid) {
    if (!jid || typeof jid !== 'string') return '';
    const trimmed = jid.trim();
    if (trimmed.includes('@')) return trimmed;
    const digits = trimmed.replace(/\D/g, '');
    return digits ? `${digits}@s.whatsapp.net` : '';
}

export async function linkJids(jids, conversationId = null) {
    const uniqueJids = Array.from(new Set(jids.map(normalizeJid).filter(Boolean)));
    if (!uniqueJids.length) return null;

    return withStoreLock(async () => {
        const store = await readStore();
        let id = conversationId;

        if (id && !store.conversations[id]) {
            store.conversations[id] = { jids: [], lastJid: '', updatedAt: Date.now() };
        }

        if (!id) {
            for (const jid of uniqueJids) {
                const existingId = store.jidToConversationId[jid];
                if (existingId) {
                    id = existingId;
                    break;
                }
            }
        }

        if (!id) {
            id = generateConversationId();
            store.conversations[id] = { jids: [], lastJid: '', updatedAt: Date.now() };
        }

        const entry = store.conversations[id];
        for (const jid of uniqueJids) {
            store.jidToConversationId[jid] = id;
            if (!entry.jids.includes(jid)) {
                entry.jids.push(jid);
            }
        }
        entry.lastJid = uniqueJids[uniqueJids.length - 1];
        entry.updatedAt = Date.now();

        await writeStore(store);
        return id;
    });
}

export async function getConversationIdForJid(jid) {
    const normalized = normalizeJid(jid);
    if (!normalized) return null;

    return withStoreLock(async () => {
        const store = await readStore();
        return store.jidToConversationId[normalized] || null;
    });
}

export async function resolveConversationJid(conversationId) {
    if (!conversationId) return null;
    return withStoreLock(async () => {
        const store = await readStore();
        const entry = store.conversations[conversationId];
        if (!entry) return null;
        return entry.lastJid || entry.jids[entry.jids.length - 1] || null;
    });
}

export async function getLinkedJidsForConversationId(conversationId) {
    if (!conversationId) return [];
    return withStoreLock(async () => {
        const store = await readStore();
        const entry = store.conversations[conversationId];
        if (!entry) return [];
        return entry.jids || [];
    });
}

export async function findConversationIdByJid(jid) {
    if (!jid) return null;
    return withStoreLock(async () => {
        const store = await readStore();
        return store.jidToConversationId[jid] || null;
    });
}
