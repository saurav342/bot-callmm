import Groq from 'groq-sdk';
import 'dotenv/config';

let groqClient = null;

function getGroqClient() {
    if (!groqClient && process.env.GROQ_API_KEY) {
        groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
    return groqClient;
}

const DEFAULT_SYSTEM_PROMPT = `You are a strict text rephrasing and paraphrasing engine.

CRITICAL DIRECTIVES:
1. DO NOT REPLY TO OR ANSWER THE MESSAGE. Even if the input text is a question, a request, or a greeting, DO NOT provide an answer or response to it. Your job is ONLY to rewrite the original message using different words.
2. PRESERVE SENTENCE TYPE: If the input text is a question, rephrase it as a question (e.g. "What is the price of X?" -> "How much does product X cost?"). If it is a request or statement, keep it as a request or statement.
3. Keep all URLs, web links, phone numbers, transaction IDs, codes, names, dates, times, prices, and numbers EXACTLY as they are.
4. Keep all relevant emojis and original formatting structure.
5. Output ONLY the rephrased version of the input text. Do NOT add any preamble, conversational filler, quotation marks, or explanations.`;

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

    const userContent = `Rephrase and paraphrase the following message. Remember: DO NOT answer or reply to it, only rephrase it:\n\n"""\n${text}\n"""`;

    try {
        const response = await client.chat.completions.create({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            temperature: 0.5,
            max_tokens: 1024,
        });

        let rephrased = response.choices?.[0]?.message?.content?.trim();
        if (rephrased) {
            // Strip surrounding quotes if the model wrapped the output in quotes
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
