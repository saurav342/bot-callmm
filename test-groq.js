import { rephraseText } from './groq-rephraser.js';

async function runTest() {
    console.log('🧪 Testing Groq API Rephraser with Stock Signal Calls...\n');
    
    const testCases = [
        `24 July
Axis bank cmp 1228
SL 1199
Target 1250/1300

1237💥… This will move soon`,

        `15 July
Tata Motors cmp 950
SL 920
Target 980/1020

975🚀… Target 1 almost done!`,

        `ICICI Bank cmp 1100
SL 1080
TGT 1140/1180

1140💥 Target 1 achieved!`
    ];

    for (const [index, msg] of testCases.entries()) {
        console.log(`=== TEST CASE ${index + 1} ===`);
        console.log('--- ORIGINAL ---');
        console.log(msg);
        console.log('\n--- REPHRASED ---');
        const rephrased = await rephraseText(msg);
        console.log(rephrased);
        console.log('\n');
    }
}

runTest();
