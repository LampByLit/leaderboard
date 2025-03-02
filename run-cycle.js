const fs = require('fs').promises;
const path = require('path');
const { cycle } = require('./scripts/cycle.js');

// Check if we can access the Railway volume
async function checkVolumeAccess() {
    const DATA_DIR = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data'));
    console.log(`\n📂 Data directory path: ${DATA_DIR}`);
    
    try {
        // Check if the directory exists and is accessible
        await fs.access(DATA_DIR);
        
        // Try to list files in the directory
        const files = await fs.readdir(DATA_DIR);
        console.log(`✅ Volume access OK. Found ${files.length} files:`);
        for (const file of files) {
            // Get file stats
            try {
                const stats = await fs.stat(path.join(DATA_DIR, file));
                console.log(`   - ${file} (${stats.isDirectory() ? 'Directory' : 'File'}, ${stats.size} bytes)`);
            } catch (err) {
                console.log(`   - ${file} (Error getting stats: ${err.message})`);
            }
        }
        return true;
    } catch (error) {
        console.error(`❌ Volume access ERROR: ${error.message}`);
        console.error(`   Is the RAILWAY_VOLUME_MOUNT_PATH correct? (${process.env.RAILWAY_VOLUME_MOUNT_PATH || 'Not set'})`);
        console.error('   If using Railway: Make sure the volume is attached to this service');
        console.error('   For help, see: https://station.railway.com/questions/browse-files-on-a-volume-d3481b4f');
        return false;
    }
}

async function runCycle() {
    try {
        console.log('\n🚀 Starting Leaderboard Cycle');
        
        // Check volume access first
        const volumeAccessOk = await checkVolumeAccess();
        if (!volumeAccessOk) {
            console.error('⚠️ WARNING: Volume access issues detected, but attempting to continue anyway...');
        }
        
        const result = await cycle();
        console.log('\n🏁 Cycle Result:', JSON.stringify(result, null, 2));
        
        // Print friendly summary
        if (result.success) {
            console.log('\n🎉 SUCCESS! Leaderboard update completed');
            if (result.stats && result.stats.duration) {
                console.log(`⏱️ Total duration: ${result.stats.duration}`);
            }
        } else {
            console.error('\n❌ FAILED! Leaderboard update did not complete');
            console.error(`❓ Error: ${result.error}`);
        }
    } catch (error) {
        console.error('\n💥 Critical Error:', error.message);
        console.error('\n🔍 Error Details:', error.stack);
        process.exit(1);
    }
}

runCycle(); 