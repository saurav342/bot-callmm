import { rephraseText } from './groq-rephraser.js';

async function runTest() {
    console.log('🧪 Testing Groq API Rephraser (Strict Paraphrase Test)...\n');
    
    const testCases = [
        "Are you free for a call at 4 PM today?",
        "Please send me the account details as soon as possible.",
        "What is the price of product X?",
        "Hello team, please remember to submit your weekly report by 5 PM today. Check the link: https://example.com/reports or call +1234567890."
    ];

    for (const [index, original] of testCases.entries()) {
        console.log(`--- Test ${index + 1} ---`);
        console.log(`INPUT:    "${original}"`);
        const rephrased = await rephraseText(original);
        console.log(`REPHRASED: "${rephrased}"\n`);
    }
}

runTest();
