const fs = require('fs').promises;
const path = require('path');
const { scrape } = require('./scraper');
const { publish } = require('./publisher');
const { purge } = require('./purger');
const { cleanup } = require('./cleaner');

// Configure data directory
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '.';

// Helper function to get data file paths
function getDataPath(filename) {
    return path.join(DATA_DIR, filename);
}

async function safeWriteJSON(filePath, data) {
    const backupPath = `${filePath}.backup`;
    try {
        // Create backup of current file if it exists
        try {
            const currentData = await fs.readFile(filePath, 'utf8');
            await fs.writeFile(backupPath, currentData);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }

        // Write new data
        await fs.writeFile(filePath, JSON.stringify(data, null, 4));
        
        // Remove backup after successful write
        try {
            await fs.unlink(backupPath);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.warn('Warning: Could not remove backup file:', err);
            }
        }
    } catch (error) {
        console.error('Error in safeWriteJSON:', error);
        throw error;
    }
}

/**
 * Runs a complete cycle of operations:
 * 1. Cleanup - Removes invalid submissions
 * 2. Scrape - Fetches latest data from Amazon
 * 3. Purge - Removes blacklisted authors
 * 4. Publish - Updates the leaderboard
 */
async function cycle() {
    const startTime = Date.now();
    const stats = {
        scrape: null,
        purge: null,
        cleanup: null,
        publish: null
    };
    
    try {
        console.log('Starting cycle process...');
        
        // Update cycle status
        const metadataPath = getDataPath('metadata.json');
        let metadata;
        try {
            metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        } catch (error) {
            if (error.code === 'ENOENT') {
                metadata = { books: {}, last_update: new Date().toISOString() };
            } else {
                throw error;
            }
        }
        
        metadata.cycle_status = {
            state: 'running',
            started_at: new Date().toISOString()
        };
        await safeWriteJSON(metadataPath, metadata);
        
        // Run each process in sequence and collect stats
        console.log('Running scrape...');
        const scrapeResult = await scrape();
        if (!scrapeResult.success) {
            throw new Error(`Scrape failed: ${scrapeResult.error}`);
        }
        stats.scrape = scrapeResult.stats;
        
        console.log('Running purge...');
        const purgeResult = await purge();
        if (!purgeResult.success) {
            throw new Error(`Purge failed: ${purgeResult.error}`);
        }
        stats.purge = purgeResult.stats;
        
        console.log('Running cleanup...');
        const cleanupResult = await cleanup();
        if (!cleanupResult.success) {
            throw new Error(`Cleanup failed: ${cleanupResult.error}`);
        }
        stats.cleanup = cleanupResult.stats;
        
        console.log('Running publish...');
        const publishResult = await publish();
        if (!publishResult.success) {
            throw new Error(`Publish failed: ${publishResult.error}`);
        }
        stats.publish = publishResult.stats;
        
        // Calculate total duration
        const duration = Date.now() - startTime;
        
        // Update cycle status
        metadata.cycle_status = {
            state: 'completed',
            completed_at: new Date().toISOString(),
            duration: duration
        };
        await safeWriteJSON(metadataPath, metadata);
        
        console.log('Cycle process completed successfully');
        return {
            success: true,
            stats: {
                ...stats,
                duration: `${(duration / 1000).toFixed(2)}s`,
                timestamp: new Date().toISOString()
            }
        };
    } catch (error) {
        console.error('Cycle process failed:', error);
        
        // Calculate duration even for failed cycles
        const duration = Date.now() - startTime;
        
        // Update cycle status on failure
        try {
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
            metadata.cycle_status = {
                state: 'failed',
                error: error.message,
                failed_at: new Date().toISOString(),
                duration: duration
            };
            await safeWriteJSON(metadataPath, metadata);
        } catch (statusError) {
            console.error('Failed to update cycle status:', statusError);
        }
        
        return {
            success: false,
            error: error.message || 'Unknown error during cycle',
            stats: {
                ...stats,
                duration: `${(duration / 1000).toFixed(2)}s`,
                timestamp: new Date().toISOString()
            }
        };
    }
}

module.exports = { cycle };