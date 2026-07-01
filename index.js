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

// ─── CONFIGURATION ──────────────────────────────────────────

const CHAINS = [
    {
        name: 'Bot 1 (num2 connector)',
        source: '202267793821759@lid',    // num1 — listen for messages FROM
        target: '204797596708883@lid',    // num3 — forward messages TO
        authFolder: './auth_session',      // scan QR with num2
    },
    {
        name: 'Bot 2 (num3 connector)',
        source: '3434434@lid',            // num2 — listen for messages FROM
        target: '585686@lid',             // num4 — forward messages TO
        authFolder: './auth_session_2',    // scan QR with num3
    },
];

// ─── LOGGER ─────────────────────────────────────────────────
const logger = pino({ level: 'silent' });

// ─── BOT STARTER ────────────────────────────────────────────
async function startChain(chain) {
    const { name, source, target, authFolder } = chain;
    const tag = `[${name}]`;

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
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
                console.log(`🚪 ${tag} Logged out. Delete ${authFolder} and restart.\n`);
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
            const isSource = from === source;
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
