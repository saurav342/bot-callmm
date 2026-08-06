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

Your task is to rephrase raw stock calls and follow-up updates into short, clean, super simple WhatsApp messages.

STRICT RULES:
1. PRESERVE DATES: If a date is present in the original message (e.g. "29 July", "24 July", "12 June", "14 July"), ALWAYS include it prominently in the rephrased message (e.g. "🗓️ 29 July" or "Date: 29 July").
2. KEEP IT SIMPLE & SHORT: Use simple bullet points with clean emojis.
3. PRESERVE NUMBERS: Keep exact CMP, Entry, SL, Targets, %, and price updates.
4. CURRENCY ACCURACY: Use $ for US stocks, ₹ or points for Indian assets.

STRUCTURE:
• Title / Asset (with Date if present)
• CMP / Entry
• SL / Target(s)
• Status / Action (e.g., Target Done 💥, Book Part Profit, Hold)

Output ONLY the rephrased message without preamble or quote marks.`;

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
