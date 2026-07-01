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

// ─── CONFIGURATION ──────────────────────────────────────────
// num2 (source) → num3 (this bot / connector) → num4 (target)

const SOURCE_NUMBER = '194544889016378@lid';       // num2 — listen for messages FROM this number
const TARGET_NUMBER = '202267793821759@lid';        // num4 — forward messages TO this number

// ─── LOGGER ─────────────────────────────────────────────────
const logger = pino({ level: 'silent' }); // set to 'debug' for troubleshooting

// ─── MAIN ───────────────────────────────────────────────────
async function startBot() {
    // Separate auth session so num3 can log in independently
    const { state, saveCreds } = await useMultiFileAuthState('./auth_session_2');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false,
        browser: ['ForwardBot2', 'Chrome', '1.0.0'],
    });

    // ── QR Code ────────────────────────────────────────────────
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.clear();
            console.log('\n📱 Scan this QR code with num3\'s WhatsApp:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.clear();
            console.log('========================================');
            console.log('  ✅  Connected to WhatsApp! (Bot 2)');
            console.log('========================================');
            console.log(`\n  📥  Listening for messages from (num2):`);
            console.log(`      ${SOURCE_NUMBER}`);
            console.log(`\n  📤  Forwarding messages to (num4):`);
            console.log(`      ${TARGET_NUMBER}`);
            console.log('\n────────────────────────────────────────\n');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`\n⚠️  Connection closed (code: ${statusCode})`);

            if (shouldReconnect) {
                console.log('🔄 Reconnecting in 3 seconds...\n');
                setTimeout(startBot, 3000);
            } else {
                console.log('🚪 Logged out. Delete the ./auth_session_2 folder and restart to re-login.\n');
            }
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
                await sock.sendMessage(TARGET_NUMBER, { forward: msg });
                console.log(`   ✅ Forwarded successfully!\n`);
            } catch (err) {
                console.error(`   ❌ Forward FAILED: ${err.message}`);
                console.error(`   Full error: ${err.stack}\n`);
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
