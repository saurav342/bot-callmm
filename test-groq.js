import { rephraseText } from './groq-rephraser.js';

async function runTest() {
    console.log('🧪 Testing Groq API Rephraser with llama-3.1-8b-instant...\n');
    const sampleMessage = "Hello team, please remember to submit your weekly report by 5 PM today. Check the link: https://example.com/reports or call +1234567890.";
    
    console.log('Original message:');
    console.log(`"${sampleMessage}"\n`);
    
    console.log('Rephrasing...');
    const rephrased = await rephraseText(sampleMessage);
    
    console.log('Rephrased message:');
    console.log(`"${rephrased}"\n`);
}

runTest();
