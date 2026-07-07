// ============================================================
//  WhatsApp Message Forwarder — Combined Bot
//  Runs BOTH forwarding chains in a single process
//  Chain 1: num1 → num2 (connector) → num3
//  Chain 2: num2 → num3 (connector) → num4
// ============================================================

import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { MongoClient } from 'mongodb';
import { useMongoAuthState } from './mongo-auth.js';

// ─── CONFIGURATION ──────────────────────────────────────────

const CHAINS = [
    {
        name: 'Bot 1 (num2 connector)',
        source: new Set([
            '202267793821759@lid',
            '120363426708859608@g.us',
            '120363409105907581@g.us',
        ]),                                    // listen for messages FROM any of these
        target: '255061347279047@lid',    // num3 — forward messages TO
        authFolder: './auth_session',      // scan QR with num2
        sessionId: 'bot_1',
    },
    {
        name: 'Bot 2 (num3 connector)',
        source: '204797596708883@lid',            // num2 — listen for messages FROM
        target: "120363425216547154@g.us",             // num4 — forward messages TO
        authFolder: './auth_session_2',    // scan QR with num3
        sessionId: 'bot_2',
    },
];

// ─── DATABASE INITIALIZATION ────────────────────────────────
let sessionsCollection = null;

if (process.env.MONGODB_URL) {
    try {
        console.log('📦 MONGODB_URL found. Connecting to MongoDB...');
        const mongoClient = new MongoClient(process.env.MONGODB_URL);
        await mongoClient.connect();
        const db = mongoClient.db();
        sessionsCollection = db.collection('whatsapp_sessions');
        console.log('✅ MongoDB connected successfully!');
    } catch (err) {
        console.error('❌ Failed to connect to MongoDB, falling back to local files:', err.message);
    }
} else {
    console.log('ℹ️  No MONGODB_URL found. Local filesystem will be used for session storage.');
}

// ─── LOGGER ─────────────────────────────────────────────────
const logger = pino({ level: 'silent' });

// ─── BOT STARTER ────────────────────────────────────────────
async function startChain(chain) {
    const { name, source, target, authFolder, sessionId } = chain;
    const tag = `[${name}]`;

    let authState;
    if (sessionsCollection) {
        console.log(`📡 ${tag} Using MongoDB authentication state (session: ${sessionId})`);
        authState = await useMongoAuthState(sessionsCollection, sessionId);
    } else {
        console.log(`💾 ${tag} Using filesystem authentication state`);
        authState = await useMultiFileAuthState(authFolder);
    }

    const { state, saveCreds } = authState;
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false,
        browser: [name, 'Chrome', '1.0.0'],
    });

    // ── Connection events ──────────────────────────────────────
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.log(`\n📱 ${tag} Scan this QR code:\n`);
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('========================================');
            console.log(`  ✅ ${tag} Connected!`);
            console.log('========================================');
            console.log(`  📥  Source: ${source}`);
            console.log(`  📤  Target: ${target}`);
            console.log('────────────────────────────────────────\n');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`\n⚠️  ${tag} Connection closed (code: ${statusCode})`);

            if (shouldReconnect) {
                console.log(`🔄 ${tag} Reconnecting in 3 seconds...\n`);
                setTimeout(() => startChain(chain), 3000);
            } else {
                console.log(`🚪 ${tag} Logged out. Delete ${sessionsCollection ? 'session records for ' + sessionId + ' from database' : authFolder} and restart.\n`);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ── Message handler ────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            const timestamp = new Date().toLocaleTimeString();
            const from = msg.key.remoteJid;
            const fromMe = msg.key.fromMe;
            const isSource = source instanceof Set ? source.has(from) : from === source;
            const preview = getMessagePreview(msg);

            console.log(`${tag} 📩 [${timestamp}] From: ${from} | ${preview} | Source? ${isSource ? '✅' : '❌'}`);

            if (fromMe || !msg.message || !isSource) continue;

            console.log(`${tag} ➡  Forwarding to ${target}...`);
            try {
                await sock.sendMessage(target, { forward: msg });
                console.log(`${tag} ✅ Forwarded!`);
            } catch (err) {
                console.error(`${tag} ❌ Failed: ${err.message}`);
            }
        }
    });
}

// ─── HELPERS ────────────────────────────────────────────────
function getMessagePreview(msg) {
    const m = msg.message;
    if (!m) return '[empty]';
    if (m.conversation) return `💬 ${m.conversation}`;
    if (m.extendedTextMessage?.text) return `💬 ${m.extendedTextMessage.text}`;
    if (m.imageMessage) return `🖼️  Image`;
    if (m.videoMessage) return `🎥 Video`;
    if (m.audioMessage) return `🎵 Audio`;
    if (m.documentMessage) return `📄 Document`;
    if (m.stickerMessage) return `🏷️  Sticker`;
    if (m.contactMessage) return `👤 Contact`;
    if (m.locationMessage) return `📍 Location`;
    if (m.reactionMessage) return `😀 Reaction`;
    if (m.viewOnceMessageV2 || m.viewOnceMessage) return `👁️  View Once`;
    return `[${Object.keys(m).join(', ')}]`;
}

// ─── START ALL CHAINS ───────────────────────────────────────
console.log('\n🚀 Starting WhatsApp Forwarder (Combined)...\n');
console.log(`📋 Running ${CHAINS.length} forwarding chains\n`);

for (const chain of CHAINS) {
    startChain(chain).catch(err => {
        console.error(`💥 ${chain.name} fatal error:`, err);
    });
}
