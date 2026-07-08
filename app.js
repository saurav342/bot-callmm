// ============================================================
//  WhatsApp Message Forwarder Bot
//  Forward messages from one number to another using Baileys
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
// Replace these with the actual WhatsApp IDs.
// Format: <country_code><number>@s.whatsapp.net
// Example: '919876543210@s.whatsapp.net'

const SOURCE_NUMBER = '202267793821759@lid';       // listen for messages FROM this number
const TARGET_NUMBER = '204797596708883@lid';       // forward messages TO this number

// ─── LOGGER ─────────────────────────────────────────────────
const logger = pino({ level: 'silent' }); // set to 'debug' for troubleshooting

// ─── DATABASE INITIALIZATION ────────────────────────────────
let sessionsCollection = null;
const SESSION_ID = 'bot_1';

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

// ─── MAIN ───────────────────────────────────────────────────
async function startBot() {
    let authState;
    if (sessionsCollection) {
        console.log(`📡 Using MongoDB authentication state (session: ${SESSION_ID})`);
        authState = await useMongoAuthState(sessionsCollection, SESSION_ID);
    } else {
        console.log('💾 Using filesystem authentication state');
        authState = await useMultiFileAuthState('./auth_session');
    }

    const { state, saveCreds } = authState;
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false, // we handle QR ourselves below
        browser: ['ForwardBot', 'Chrome', '1.0.0'],
    });

    // ── QR Code ────────────────────────────────────────────────
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.clear();
            console.log('\n📱 Scan this QR code with your WhatsApp:\n');
            qrcode.generate(qr, { small: true });
        }

        // if (connection === 'open') {
        //     console.clear();
        //     console.log('========================================');
        //     console.log('  ✅  Connected to WhatsApp!');
        //     console.log('========================================');
        //     console.log(`\n  📥  Listening for messages from:`);
        //     console.log(`      ${SOURCE_NUMBER}`);
        //     console.log(`\n  📤  Forwarding messages to:`);
        //     console.log(`      ${TARGET_NUMBER}`);
        //     console.log('\n────────────────────────────────────────\n');
        // }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`\n⚠️  Connection closed (code: ${statusCode})`);

            if (shouldReconnect) {
                console.log('🔄 Reconnecting in 3 seconds...\n');
                setTimeout(startBot, 3000);
            } else {
                console.log(`🚪 Logged out. Delete ${sessionsCollection ? 'session records for ' + SESSION_ID + ' from database' : 'the ./auth_session folder'} and restart to re-login.\n`);
            }
        }
    });

    // ── Save credentials on update ─────────────────────────────
    sock.ev.on('creds.update', saveCreds);

    // ── Message handler ────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Only handle new messages (not history sync, edits, etc.)
        if (type !== 'notify') return;

        for (const msg of messages) {
            const timestamp = new Date().toLocaleTimeString();
            const from = msg.key.remoteJid;
            const isGroup = from?.endsWith('@g.us');
            const sender = isGroup ? (msg.key.participant || 'unknown') : from;
            const fromMe = msg.key.fromMe;
            const msgType = msg.message ? Object.keys(msg.message).filter(k => k !== 'messageContextInfo').join(', ') : 'unknown';
            const preview = getMessagePreview(msg);
            const isSource = from === SOURCE_NUMBER;

            // ── Log every message ──────────────────────────────
            console.log('────────────────────────────────────────');
            console.log(`📩 [${timestamp}] New message`);
            console.log(`   From:      ${from}`);
            if (isGroup) console.log(`   Sender:    ${sender}`);
            console.log(`   FromMe:    ${fromMe}`);
            console.log(`   Type:      ${msgType}`);
            console.log(`   Content:   ${preview}`);
            console.log(`   Source?:   ${isSource ? '✅ YES' : '❌ NO'}`);

            // Skip messages we sent ourselves
            if (fromMe) {
                console.log(`   ⏭  Skipped (sent by us)\n`);
                continue;
            }

            // Skip if no message content
            if (!msg.message) {
                console.log(`   ⏭  Skipped (no content)\n`);
                continue;
            }

            // Only forward messages from the source number
            if (!isSource) {
                console.log(`   ⏭  Skipped (not from source)\n`);
                continue;
            }

            // Forward to target
            console.log(`   ➡  FORWARDING to ${TARGET_NUMBER}...`);
            try {
                await sock.sendMessage(TARGET_NUMBER, { forward: cleanMessageForForwarding(msg) });
                console.log(`   ✅ Forwarded successfully!\n`);
            } catch (err) {
                console.error(`   ❌ Forward FAILED: ${err.message}`);
                console.error(`   Full error: ${err.stack}\n`);
            }
        }
    });
}

// ─── HELPERS ────────────────────────────────────────────────

function cleanMessageForForwarding(msg) {
    if (!msg) return msg;

    const cleanMsg = {
        ...msg,
        key: {
            ...msg.key,
            fromMe: true
        }
    };

    if (cleanMsg.message) {
        cleanMsg.message = cloneMessage(cleanMsg.message);

        for (const key of Object.keys(cleanMsg.message)) {
            const content = cleanMsg.message[key];
            if (content && typeof content === 'object') {
                if (content.contextInfo) {
                    delete content.contextInfo.forwardingScore;
                    delete content.contextInfo.isForwarded;
                }
            }
        }
    }

    return cleanMsg;
}

function cloneMessage(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (Buffer.isBuffer(obj)) {
        return Buffer.from(obj);
    }
    if (obj instanceof Uint8Array) {
        return new Uint8Array(obj);
    }
    if (Array.isArray(obj)) {
        return obj.map(cloneMessage);
    }
    const cloned = {};
    for (const key of Object.keys(obj)) {
        cloned[key] = cloneMessage(obj[key]);
    }
    return cloned;
}

/**
 * Extract a human-readable preview of the message content.
 */
function getMessagePreview(msg) {
    const m = msg.message;
    if (!m) return '[empty]';

    if (m.conversation) return `💬 ${m.conversation}`;
    if (m.extendedTextMessage?.text) return `💬 ${m.extendedTextMessage.text}`;
    if (m.imageMessage) return `🖼️  Image${m.imageMessage.caption ? ': ' + m.imageMessage.caption : ''}`;
    if (m.videoMessage) return `🎥 Video${m.videoMessage.caption ? ': ' + m.videoMessage.caption : ''}`;
    if (m.audioMessage) return `🎵 Audio (${m.audioMessage.ptt ? 'voice note' : 'file'})`;
    if (m.documentMessage) return `📄 Document: ${m.documentMessage.fileName || 'file'}`;
    if (m.stickerMessage) return `🏷️  Sticker`;
    if (m.contactMessage) return `👤 Contact: ${m.contactMessage.displayName}`;
    if (m.locationMessage) return `📍 Location`;
    if (m.liveLocationMessage) return `📍 Live Location`;
    if (m.reactionMessage) return `😀 Reaction: ${m.reactionMessage.text}`;
    if (m.viewOnceMessageV2 || m.viewOnceMessage) return `👁️  View Once Message`;

    return `[${Object.keys(m).join(', ')}]`;
}

// ─── START ──────────────────────────────────────────────────
console.log('\n🚀 Starting WhatsApp Forwarder Bot...\n');
startBot().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});
