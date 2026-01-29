import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const toNumber = (value, fallback) => {

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
    port: toNumber(process.env.PORT, 3000),
    host: process.env.HOST || '0.0.0.0',
    apiKey: process.env.API_KEY || '',
    webhookUrl: process.env.WEBHOOK_URL || '',
    webhookSecret: process.env.WEBHOOK_SECRET || '',
    webhookFilterMode: process.env.WEBHOOK_FILTER_MODE || 'all',
    webhookGroupAllowlist: [],
    webhookIgnoreFromMe: process.env.WEBHOOK_IGNORE_FROM_ME === 'true',
    rateLimitMax: toNumber(process.env.RATE_LIMIT_MAX, 60),
    rateLimitWindowMs: toNumber(process.env.RATE_LIMIT_WINDOW_MS, 60000),
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', 'data');
const webhookFile = path.join(dataDir, 'webhook.json');

async function loadWebhookConfig() {
    try {
        const raw = await fs.readFile(webhookFile, 'utf-8');
        const parsed = JSON.parse(raw || '{}');
        if (typeof parsed.webhookUrl === 'string') {
            config.webhookUrl = parsed.webhookUrl;
        }
        if (typeof parsed.webhookSecret === 'string') {
            config.webhookSecret = parsed.webhookSecret;
        }
        if (typeof parsed.webhookFilterMode === 'string') {
            config.webhookFilterMode = parsed.webhookFilterMode;
        }
        if (Array.isArray(parsed.webhookGroupAllowlist)) {
            config.webhookGroupAllowlist = parsed.webhookGroupAllowlist;
        }
        if (typeof parsed.webhookIgnoreFromMe === 'boolean') {
            config.webhookIgnoreFromMe = parsed.webhookIgnoreFromMe;
        }
    } catch {
        // Ignore missing/invalid file; env defaults remain.
    }
}

loadWebhookConfig().catch(() => {});

function parseAllowlist(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(/[\n,]/)
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}

export function updateWebhookConfig({
    webhookUrl,
    webhookSecret,
    webhookFilterMode,
    webhookGroupAllowlist,
    webhookIgnoreFromMe,
}) {
    if (typeof webhookUrl === 'string') {
        config.webhookUrl = webhookUrl;
    }
    if (typeof webhookSecret === 'string') {
        config.webhookSecret = webhookSecret;
    }
    if (typeof webhookFilterMode === 'string') {
        config.webhookFilterMode = webhookFilterMode;
    }
    if (typeof webhookGroupAllowlist !== 'undefined') {
        config.webhookGroupAllowlist = parseAllowlist(webhookGroupAllowlist);
    }
    if (typeof webhookIgnoreFromMe === 'boolean') {
        config.webhookIgnoreFromMe = webhookIgnoreFromMe;
    }

    fs.mkdir(dataDir, { recursive: true })
        .then(() => fs.writeFile(webhookFile, JSON.stringify({
            webhookUrl: config.webhookUrl,
            webhookSecret: config.webhookSecret,
            webhookFilterMode: config.webhookFilterMode,
            webhookGroupAllowlist: config.webhookGroupAllowlist,
            webhookIgnoreFromMe: config.webhookIgnoreFromMe,
        }, null, 2)))
        .catch(() => {});
}
export function requireApiKey() {
    if (!config.apiKey) {
        throw new Error('API key is required but not set in the environment variables.');
    }
}
