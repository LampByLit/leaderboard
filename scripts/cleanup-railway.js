const fs = require('fs').promises;
const path = require('path');

async function cleanupRailwayVolume() {
    // Railway always mounts volumes at /data in the container
    const RAILWAY_VOLUME = '/data';
    
    const filesToDelete = [
        path.join(RAILWAY_VOLUME, 'input.json'),
        path.join(RAILWAY_VOLUME, 'books.json')
    ];

    console.log('🧹 Starting Railway volume cleanup...');
    console.log(`📂 Targeting Railway volume at: ${RAILWAY_VOLUME}`);
    
    for (const file of filesToDelete) {
        try {
            await fs.unlink(file);
            console.log(`✅ Successfully deleted: ${file}`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`ℹ️ File not found (already deleted): ${file}`);
            } else {
                console.error(`❌ Error deleting ${file}:`, error.message);
            }
        }
    }
    
    console.log('🎉 Railway volume cleanup complete!');
}

// Run the cleanup
cleanupRailwayVolume().catch(error => {
    console.error('❌ Fatal error during cleanup:', error);
    process.exit(1);
}); 