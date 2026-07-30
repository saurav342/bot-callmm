// ============================================================
//  WhatsApp Message Forwarder Bot (Instance 2)
//  num3 is the connector: forwards messages from num2 → num4
// ============================================================

import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { MongoClient } from 'mongodb';
import { useMongoAuthState, clearAuthState } from './mongo-auth.js';
import { rephraseText } from './groq-rephraser.js';

// ─── CONFIGURATION ──────────────────────────────────────────
// num2 (source) → num3 (this bot / connector) → num4 (target)

const SOURCE_NUMBER = '194544889016378@lid';       // num2 — listen for messages FROM this number
const TARGET_NUMBER = '202267793821759@lid';        // num4 — forward messages TO this number
const ENABLE_REPHRASE = true;                       // Enable Groq rephrasing for Bot 2 (llama-3.1-8b-instant)


// ─── LOGGER ─────────────────────────────────────────────────
const logger = pino({ level: 'silent' }); // set to 'debug' for troubleshooting

// ─── DATABASE INITIALIZATION ────────────────────────────────
let sessionsCollection = null;
const SESSION_ID = 'bot_2';

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
        authState = await useMultiFileAuthState('./auth_session_2');
    }

    const { state, saveCreds } = authState;
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false,
        browser: ['ForwardBot2', 'Chrome', '1.0.0'],
    });

    // ── QR Code ────────────────────────────────────────────────
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        try {
            if (qr) {
                console.clear();
                console.log('\n📱 Scan this QR code with num3\'s WhatsApp:\n');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'open') {
                console.log('========================================');
                console.log('  ✅  Connected to WhatsApp! (Bot 2)');
                console.log('========================================');
                console.log(`\n  📥  Listening for messages from (num2): ${SOURCE_NUMBER}`);
                console.log(`  📤  Forwarding messages to (num4): ${TARGET_NUMBER}`);
                console.log('────────────────────────────────────────\n');

                try {
                    console.log('👥 Fetching joined groups & communities...');
                    const groups = await sock.groupFetchAllParticipating();
                    const groupList = Object.values(groups);
                    if (groupList.length === 0) {
                        console.log('ℹ️  No joined groups or communities found.');
                    } else {
                        console.log(`📋 Joined Groups & Communities (${groupList.length}):`);
                        for (const g of groupList) {
                            const category = g.isCommunity ? '🏢 Community' : (g.isCommunityAnnounce ? '📢 Community Announcement' : '💬 Group');
                            console.log(`   • ${category}: ${g.subject} | ID: ${g.id}`);
                        }
                    }
                    console.log('────────────────────────────────────────\n');
                } catch (err) {
                    console.error('❌ Error fetching groups/communities:', err.message);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

                console.log(`\n⚠️  Connection closed (code: ${statusCode})`);

                if (isLoggedOut) {
                    console.log(`🚪 Logged out. Clearing session data and generating new QR code...\n`);
                    await clearAuthState(sessionsCollection, SESSION_ID, './auth_session_2');
                    console.log('🔄 Restarting bot in 3 seconds for new QR code...\n');
                    setTimeout(startBot, 3000);
                } else {
                    console.log('🔄 Reconnecting in 3 seconds...\n');
                    setTimeout(startBot, 3000);
                }
            }
        } catch (err) {
            console.error('❌ Error handling connection update:', err);
        }
    });

    // ── Save credentials on update ─────────────────────────────
    sock.ev.on('creds.update', saveCreds);

    // ── Message handler ────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
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

            if (fromMe) {
                console.log(`   ⏭  Skipped (sent by us)\n`);
                continue;
            }

            if (!msg.message) {
                console.log(`   ⏭  Skipped (no content)\n`);
                continue;
            }

            if (!isSource) {
                console.log(`   ⏭  Skipped (not from source)\n`);
                continue;
            }

            // Forward to target
            console.log(`   ➡  FORWARDING to ${TARGET_NUMBER}...`);
            try {
                const messageToSend = await prepareMessageForForwarding(msg, ENABLE_REPHRASE);
                await sock.sendMessage(TARGET_NUMBER, { forward: messageToSend });
                console.log(`   ✅ Forwarded successfully!\n`);
            } catch (err) {
                console.error(`   ❌ Forward FAILED: ${err.message}`);
                console.error(`   Full error: ${err.stack}\n`);
            }
        }
    });
}

// ─── HELPERS ────────────────────────────────────────────────

async function prepareMessageForForwarding(msg, enableRephrase = false) {
    const cleanMsg = cleanMessageForForwarding(msg);
    if (!enableRephrase || !cleanMsg?.message) return cleanMsg;

    const m = cleanMsg.message;

    try {
        if (m.conversation) {
            const original = m.conversation;
            console.log(`   🤖 Rephrasing text with Groq (llama-3.1-8b-instant)...`);
            const rephrased = await rephraseText(original);
            if (rephrased && rephrased !== original) {
                console.log(`   ✨ Original: "${original}"`);
                console.log(`   ✨ Rephrased: "${rephrased}"`);
                m.conversation = rephrased;
            }
        } else if (m.extendedTextMessage?.text) {
            const original = m.extendedTextMessage.text;
            console.log(`   🤖 Rephrasing extended text with Groq (llama-3.1-8b-instant)...`);
            const rephrased = await rephraseText(original);
            if (rephrased && rephrased !== original) {
                console.log(`   ✨ Original: "${original}"`);
                console.log(`   ✨ Rephrased: "${rephrased}"`);
                m.extendedTextMessage.text = rephrased;
            }
        } else if (m.imageMessage?.caption) {
            const original = m.imageMessage.caption;
            console.log(`   🤖 Rephrasing image caption with Groq...`);
            const rephrased = await rephraseText(original);
            if (rephrased && rephrased !== original) {
                console.log(`   ✨ Original Caption: "${original}"`);
                console.log(`   ✨ Rephrased Caption: "${rephrased}"`);
                m.imageMessage.caption = rephrased;
            }
        } else if (m.videoMessage?.caption) {
            const original = m.videoMessage.caption;
            console.log(`   🤖 Rephrasing video caption with Groq...`);
            const rephrased = await rephraseText(original);
            if (rephrased && rephrased !== original) {
                console.log(`   ✨ Original Caption: "${original}"`);
                console.log(`   ✨ Rephrased Caption: "${rephrased}"`);
                m.videoMessage.caption = rephrased;
            }
        } else if (m.documentMessage?.caption) {
            const original = m.documentMessage.caption;
            console.log(`   🤖 Rephrasing document caption with Groq...`);
            const rephrased = await rephraseText(original);
            if (rephrased && rephrased !== original) {
                console.log(`   ✨ Original Caption: "${original}"`);
                console.log(`   ✨ Rephrased Caption: "${rephrased}"`);
                m.documentMessage.caption = rephrased;
            }
        }
    } catch (err) {
        console.error(`   ⚠️ Error rephrasing message: ${err.message}`);
    }

    return cleanMsg;
}

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
console.log('\n🚀 Starting WhatsApp Forwarder Bot 2 (num3 → num4)...\n');
startBot().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});
