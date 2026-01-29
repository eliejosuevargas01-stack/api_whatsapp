import path from 'path';
import { fileURLToPath } from 'url';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const authDir = path.join(__dirname, '..', '..', 'sessions');

export async function loadAuthState() {
    return useMultiFileAuthState(authDir);
}