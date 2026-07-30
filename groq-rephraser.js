import Groq from 'groq-sdk';
import 'dotenv/config';

let groqClient = null;

function getGroqClient() {
    if (!groqClient && process.env.GROQ_API_KEY) {
        groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
    return groqClient;
}

const DEFAULT_SYSTEM_PROMPT = `You are an expert stock market trading call & update formatter for WhatsApp.

Your task is to rephrase raw stock calls and follow-up updates into clear, well-structured, professional stock messages.

STRICT FORMATTING STRUCTURE FOR STOCK CALLS & UPDATES:
1. Recommendation Summary:
   "We recommended [Stock Name] at [Entry CMP] (on [Date] - only if date is mentioned), with a Stop-Loss of [SL] and Targets of [Targets]."

2. Current Market Update:
   "Current market price is [Updated Price] 💥"

3. Status & Momentum:
   Describe progress toward targets based on the message content (e.g. "Moving strong towards targets!", "Target 1 achieved!", "Target 1 almost done!").

4. Closing Sign-Off:
   Add a short encouraging closing line (e.g. "Enjoy the momentum!", "Keep holding!").

STRICT NUMERICAL & PLACEHOLDER RULES:
- Preserve ALL exact numbers (Prices, Entry CMP, SL, Targets, Updated CMP, Dates, Stock Symbol).
- NEVER output literal bracket placeholders like "[Date]", "[Stock Name]", or "[Current Date]". If a detail (like date) is not in the original text, simply omit that phrase.
- NEVER fabricate, change, or drop any numbers or stock prices.
- Keep relevant emojis (💥, 🚀, 📈).
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
        console.error(`❌ [Groq Rephraser] API call failed: ${err.message}. Using original message.`);
        return text;
    }
}
