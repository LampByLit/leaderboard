const { cycle } = require('./scripts/cycle.js');

async function runCycle() {
    try {
        const result = await cycle();
        console.log('\nCycle Result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('\nCycle Error:', error);
        console.error('\nError Stack:', error.stack);
        process.exit(1);
    }
}

runCycle(); 