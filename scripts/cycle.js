/**
 * Leaderboard Update Cycle
 * =======================
 * 
 * Orchestrates the complete update cycle for the leaderboard system.
 * This is the main conductor that ensures all operations happen in the correct sequence.
 * 
 * Cycle Sequence:
 * 1. Cleanup  - Remove invalid/failed submissions
 * 2. Scrape   - Fetch latest data from Amazon
 * 3. Purge    - Remove blacklisted entries
 * 4. Publish  - Update the leaderboard
 * 
 * Features:
 * - Atomic file operations with backups
 * - Progress tracking and status updates
 * - Error handling and recovery
 * - Cycle state persistence
 * 
 * File Dependencies:
 * - input.json: Source of Amazon URLs
 * - metadata.json: Internal state and book data
 * - books.json: Published leaderboard data
 * - blacklist.json: Filtering patterns
 * 
 * @module cycle
 */

const fs = require('fs').promises;
const path = require('path');
const { scrape } = require('./scraper');
const { publish } = require('./publisher');
const { purge } = require('./purger');
const { cleanup } = require('./cleaner');

// Configure data directory
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '.';

// Add lock file path constant
const LOCK_FILE = path.join(DATA_DIR, 'cycle.lock');

// Helper function to check if cycle is running
async function isCycleLocked() {
    try {
        await fs.access(LOCK_FILE);
        // Check if lock is stale (older than 1 hour)
        const stats = await fs.stat(LOCK_FILE);
        const lockAge = Date.now() - stats.mtime;
        if (lockAge > 3600000) { // 1 hour in milliseconds
            await fs.unlink(LOCK_FILE);
            return false;
        }
        return true;
    } catch (error) {
        return false;
    }
}

// Helper function to create lock
async function createLock() {
    await fs.writeFile(LOCK_FILE, new Date().toISOString());
}

// Helper function to release lock
async function releaseLock() {
    try {
        await fs.unlink(LOCK_FILE);
    } catch (error) {
        console.warn('Warning: Could not remove lock file:', error);
    }
}

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
    try {
        // Check if another cycle is running
        if (await isCycleLocked()) {
            console.log('🔒 Another cycle is currently running. Please wait.');
            return {
                success: false,
                error: 'CYCLE_LOCKED',
                message: 'Another cycle is currently running'
            };
        }

        // Create lock
        await createLock();
        console.log('\n🚀 Initializing cycle process...');
        console.log('📋 Checking system state and dependencies...');

        const startTime = Date.now();
        const stats = {
            scrape: null,
            purge: null,
            cleanup: null,
            publish: null
        };
        
        try {
            // Update cycle status
            const metadataPath = getDataPath('metadata.json');
            let metadata;
            try {
                metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
                console.log('✅ Successfully loaded metadata');
            } catch (error) {
                if (error.code === 'ENOENT') {
                    console.log('⚠️ No existing metadata found, creating new...');
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
            console.log('✅ Cycle status updated');
            
            // Run each process in sequence and collect stats
            console.log('\n🔄 Starting scrape process...');
            console.log('📚 This may take several minutes depending on the number of submissions...');
            const scrapeResult = await scrape();
            if (!scrapeResult.success) {
                throw new Error(`Scrape failed: ${scrapeResult.error}`);
            }
            stats.scrape = scrapeResult.stats;
            console.log('✅ Scrape process completed successfully');
            
            console.log('\n🧹 Starting purge process...');
            console.log('🔍 Checking books against blacklist criteria...');
            const purgeResult = await purge();
            if (!purgeResult.success) {
                throw new Error(`Purge failed: ${purgeResult.error}`);
            }
            stats.purge = purgeResult.stats;
            console.log('✅ Purge process completed successfully');
            
            console.log('\n🧼 Starting cleanup process...');
            console.log('📊 Analyzing submission history and failures...');
            const cleanupResult = await cleanup();
            if (!cleanupResult.success) {
                throw new Error(`Cleanup failed: ${cleanupResult.error}`);
            }
            stats.cleanup = cleanupResult.stats;
            console.log('✅ Cleanup process completed successfully');
            
            console.log('\n📊 Starting publish process...');
            console.log('📝 Preparing leaderboard data...');
            const publishResult = await publish();
            if (!publishResult.success) {
                throw new Error(`Publish failed: ${publishResult.error}`);
            }
            stats.publish = publishResult.stats;
            console.log('✅ Publish process completed successfully');
            
            // Calculate total duration
            const duration = Date.now() - startTime;
            
            // Update cycle status
            metadata.cycle_status = {
                state: 'completed',
                completed_at: new Date().toISOString(),
                duration: duration
            };
            await safeWriteJSON(metadataPath, metadata);
            
            console.log('\n🎉 Cycle process completed successfully!');
            console.log(`⏱️ Total duration: ${(duration / 1000).toFixed(2)} seconds`);
            console.log('\n📊 Final Statistics:');
            console.log(JSON.stringify(stats, null, 2));
            
            return {
                success: true,
                stats: {
                    ...stats,
                    duration: `${(duration / 1000).toFixed(2)}s`,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            console.error('\n❌ Cycle process failed:', error);
            
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
                console.log('✅ Failure status recorded in metadata');
            } catch (statusError) {
                console.error('❌ Failed to update cycle status:', statusError);
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
        } finally {
            // Always release the lock when done
            await releaseLock();
            console.log('🔓 Cycle lock released');
        }
    } catch (error) {
        console.error('\n❌ Critical cycle error:', error);
        return {
            success: false,
            error: error.message || 'Unknown error during cycle',
            stats: {
                duration: 'N/A',
                timestamp: new Date().toISOString()
            }
        };
    }
}

module.exports = { cycle, isCycleLocked };