import Groq from 'groq-sdk';
import 'dotenv/config';

let groqClient = null;

function getGroqClient() {
    if (!groqClient && process.env.GROQ_API_KEY) {
        groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
    return groqClient;
}

const DEFAULT_SYSTEM_PROMPT = `You are an expert stock market trading call & update formatter for WhatsApp, covering Indian (NSE/BSE) and US (Nasdaq/NYSE) markets, Commodities, Options, and Market Commentary.

Your task is to rephrase raw stock calls and follow-up updates into short, clear, well-structured, professional WhatsApp messages.

STRICT FORMATTING STRUCTURE FOR STOCK CALLS & UPDATES:
1. Stock Trade Calls (Fresh Entry / Buy):
   📢 *BUY CALL: [Stock Symbol / Name]*
   • *Entry CMP:* [Entry Price / Range]
   • *Stop Loss:* [SL Price]
   • *Targets:* [Target 1] | [Target 2]
   • *Note:* [Short status note if applicable]

2. Trade Updates & Targets Achieved:
   🔥 *UPDATE: [Stock Symbol / Name]*
   • *CMP:* [Current Price] 💥 (High: [Day High if mentioned])
   • *Status:* [Target / Milestone achieved]
   • *Action:* [Book part profit / Trail SL / Hold]

3. Market Commentary, News & Earnings:
   📊 *MARKET UPDATE: [Topic / Asset]*
   • [Key support/resistance levels, earnings summary, or macro news bullets]

STRICT NUMERICAL & PLACEHOLDER RULES:
- Preserve ALL exact numbers (Prices, Entry CMP, SL, Targets, %, Dates).
- Differentiate US stocks ($) vs Indian stocks (₹ or points).
- NEVER output literal bracket placeholders like "[Stock Name]".
- Keep relevant emojis (💥, 🚀, 📈, 📢, 🔥, 📊).
- Keep messages short, executive, and clear.
- Output ONLY the formatted rephrased message without preamble or quotation marks.`;

/**
 * Rephrases a given text message using Groq API llama-3.1-8b-instant model.
 * If API key is missing or call fails, falls back gracefully to the original text.
 *
 * @param {string} text - The original text to rephrase.
 * @param {Object} [options]
 * @param {string} [options.customPrompt] - Custom system prompt if needed.
 * @param {string} [options.model] - Groq model to use (default: llama-3.1-8b-instant).
 * @returns {Promise<string>} The rephrased text or original text on failure.
 */
export async function rephraseText(text, options = {}) {
    if (!text || typeof text !== 'string' || text.trim() === '') {
        return text;
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        console.warn('⚠️  [Groq Rephraser] GROQ_API_KEY is not set. Forwarding original message.');
        return text;
    }

    const client = getGroqClient();
    if (!client) {
        console.warn('⚠️  [Groq Rephraser] Failed to initialize Groq client. Forwarding original message.');
        return text;
    }

    const model = options.model || 'llama-3.1-8b-instant';
    const systemPrompt = options.customPrompt || DEFAULT_SYSTEM_PROMPT;

    const userContent = `Rephrase the following stock update message according to the structure rules. Do NOT reply or answer, only rephrase it:\n\n"""\n${text}\n"""`;

    const maxRetries = options.maxRetries || 5;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            const response = await client.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent }
                ],
                temperature: 0.3,
                max_tokens: 1024,
            });

            let rephrased = response.choices?.[0]?.message?.content?.trim();
            if (rephrased) {
                if (rephrased.startsWith('"""') && rephrased.endsWith('"""')) {
                    rephrased = rephrased.slice(3, -3).trim();
                } else if (rephrased.startsWith('"') && rephrased.endsWith('"')) {
                    rephrased = rephrased.slice(1, -1).trim();
                }
                return rephrased;
            }
            console.warn('⚠️  [Groq Rephraser] Empty response from Groq API. Using original message.');
            return text;
        } catch (err) {
            attempt++;
            const isRateLimit = err.status === 429 || (err.message && (err.message.includes('429') || err.message.includes('Rate limit')));
            if (isRateLimit && attempt < maxRetries) {
                const delayMs = attempt * 3000;
                console.warn(`⏳ [Groq Rephraser] Rate limit hit (429). Retrying in ${delayMs}ms (Attempt ${attempt}/${maxRetries})...`);
                await new Promise(res => setTimeout(res, delayMs));
                continue;
            }
            console.error(`❌ [Groq Rephraser] API call failed: ${err.message}. Using original message.`);
            return text;
        }
    }
    return text;
}
