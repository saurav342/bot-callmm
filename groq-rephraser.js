import Groq from 'groq-sdk';
import 'dotenv/config';

let groqClient = null;

function getGroqClient() {
    if (!groqClient && process.env.GROQ_API_KEY) {
        groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
    return groqClient;
}

const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant that rephrases WhatsApp messages before forwarding.
Rules:
1. Rephrase the message naturally while preserving its original core meaning and key details.
2. Keep all URLs, web links, phone numbers, transaction codes, handles, and numbers EXACTLY intact.
3. Preserve key formatting and relevant emojis.
4. Output ONLY the rephrased message. Do NOT add any preamble, quotes, explanations, or meta commentary.`;

/**
 * Rephrases a given text message using Groq API llama-3.1-8b-instant model.
 * If API key is missing or call fails, falls back gracefully to the original text.
 *
 * @param {string} text - The original text to rephrase.
 * @param {Object} [options]
 * @param {string} [options.customPrompt] - Custom prompt/instructions if needed.
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

    try {
        const response = await client.chat.completions.create({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: text }
            ],
            temperature: 0.7,
            max_tokens: 1024,
        });

        const rephrased = response.choices?.[0]?.message?.content?.trim();
        if (rephrased) {
            return rephrased;
        }
        console.warn('⚠️  [Groq Rephraser] Empty response from Groq API. Using original message.');
        return text;
    } catch (err) {
        console.error(`❌ [Groq Rephraser] API call failed: ${err.message}. Using original message.`);
        return text;
    }
}
