import Pino from 'pino';
import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { loadAuthState } from './session.js';
import { registerEvents } from './events.js';

let socket = null;
let status = 'disconnected';
let lastQr = null;
let lastError = null;
let manualDisconnect = false;

export async function initWhatsApp() {
    if (socket) return socket;
    manualDisconnect = false;

    const { state, saveCreds } = await loadAuthState();
    const { version } = await fetchLatestBaileysVersion();

    status = 'connecting';
    lastError = null;
    console.log('WhatsApp: starting session...');

    socket = makeWASocket({
        version,
        auth: state,
        logger: Pino({ level: 'silent' }),
        printQRInTerminal: true,
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        console.log('WhatsApp: connection.update', { connection, hasQr: !!qr });
        if (qr) lastQr = qr;

        if (connection === 'open') {
            status = 'connected';
            lastQr = null;
            console.log('WhatsApp: session connected.');
            return;
        }

        if (connection === 'close') {
            status = 'disconnected';
            const reason = lastDisconnect?.error?.output?.statusCode;
            socket = null;
            console.log('WhatsApp: session closed', { reason });

            if (!manualDisconnect && reason !== DisconnectReason.loggedOut) {
                initWhatsApp().catch((err) => {
                    lastError = err?.message || String(err);
                    console.error('WhatsApp: reconnect failed', lastError);
                });
            }
        }
    });

    registerEvents(socket, () => ({ status, lastQr, lastError }));

    return socket;
}

export function getSessionStatus() {
    return { status, qr: lastQr, error: lastError };
}

export async function disconnectWhatsApp({ reset = false } = {}) {
    if (!socket) {
        status = 'disconnected';
        lastQr = null;
        return { ok: true };
    }

    try {
        manualDisconnect = true;
        await socket.logout();
        if (socket?.ws) {
            socket.ws.close();
        }
        socket = null;
        status = 'disconnected';
        lastQr = null;
        if (reset) {
            const fs = await import('fs/promises');
            const { authDir } = await import('./session.js');
            await fs.rm(authDir, { recursive: true, force: true });
        }
        return { ok: true };
    } catch (err) {
        lastError = err?.message || String(err);
        return { ok: false, error: lastError };
    }
}
