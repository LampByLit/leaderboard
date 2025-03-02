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
const DATA_DIR = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data'));

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
        // First check if the lock file exists
        try {
            await fs.access(LOCK_FILE);
            // Lock file exists, try to remove it
            await fs.unlink(LOCK_FILE);
            console.log('🔓 Cycle lock released');
        } catch (accessErr) {
            // Lock file doesn't exist, nothing to do
            if (accessErr.code === 'ENOENT') {
                console.log('⚠️ No lock file found to release');
            } else {
                console.warn(`⚠️ Error checking lock file: ${accessErr.message}`);
            }
        }
    } catch (error) {
        console.warn(`⚠️ Failed to release lock: ${error.message}`);
        // Even though we failed, don't throw an error to allow the cycle to complete
    }
}

// Helper function to get data file paths
function getDataPath(filename) {
    return path.join(DATA_DIR, filename);
}

// New function to initialize required files
async function initializeFiles() {
    console.log('\n🔍 Checking for required files...');
    
    // Check for input.json (required, don't create)
    const inputPath = getDataPath('input.json');
    try {
        await fs.access(inputPath);
        console.log('✓ Input file exists');
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error('❌ No input.json found - required for cycle');
            throw new Error('Missing input.json - this file is created by user submissions');
        } else {
            throw err;
        }
    }
    
    // Initialize metadata.json if missing
    const metadataPath = getDataPath('metadata.json');
    try {
        await fs.access(metadataPath);
        console.log('✓ Metadata file exists');
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log('⚠️ Creating new metadata.json file');
            const initialMetadata = {
                books: {},
                last_update: new Date().toISOString()
            };
            await safeWriteJSON(metadataPath, initialMetadata);
            console.log('✅ Initialized new metadata.json');
        } else {
            throw err;
        }
    }
    
    // Initialize books.json if missing
    const booksPath = getDataPath('books.json');
    try {
        await fs.access(booksPath);
        console.log('✓ Books file exists');
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log('⚠️ Creating new books.json file');
            const initialBooks = {
                version: "1.0",
                last_updated: new Date().toISOString(),
                books: {}
            };
            await safeWriteJSON(booksPath, initialBooks);
            console.log('✅ Initialized new books.json');
        } else {
            throw err;
        }
    }
    
    // Initialize brownlist.json if missing
    const brownlistPath = getDataPath('brownlist.json');
    try {
        await fs.access(brownlistPath);
        console.log('✓ Brownlist file exists');
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log('⚠️ Creating new brownlist.json file');
            const initialBrownlist = {
                version: "1.0.0",
                created_at: new Date().toISOString(),
                last_updated: new Date().toISOString(),
                rejected_books: []
            };
            await safeWriteJSON(brownlistPath, initialBrownlist);
            console.log('✅ Initialized new brownlist.json');
        } else {
            throw err;
        }
    }
    
    // Initialize cleanup_log.json if missing
    const cleanupLogPath = getDataPath('cleanup_log.json');
    try {
        await fs.access(cleanupLogPath);
        console.log('✓ Cleanup log file exists');
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log('⚠️ Creating new cleanup_log.json file');
            const initialCleanupLog = { 
                cleaned_entries: [],
                created_at: new Date().toISOString()
            };
            await safeWriteJSON(cleanupLogPath, initialCleanupLog);
            console.log('✅ Initialized new cleanup_log.json');
        } else {
            throw err;
        }
    }
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

// New helper function to load metadata with error handling
async function loadMetadata() {
    const metadataPath = getDataPath('metadata.json');
    try {
        const data = await fs.readFile(metadataPath, 'utf8');
        const metadata = JSON.parse(data);
        
        // Ensure books object exists
        if (!metadata.books) {
            console.log('⚠️ No books object found in metadata, initializing...');
            metadata.books = {};
        }
        
        return metadata;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('⚠️ No existing metadata found, creating new...');
            const metadata = { 
                books: {}, 
                last_update: new Date().toISOString() 
            };
            return metadata;
        } else if (error instanceof SyntaxError) {
            console.error('❌ Invalid JSON in metadata file:', error);
            console.log('⚠️ Creating new metadata with empty books object');
            return { 
                books: {}, 
                last_update: new Date().toISOString() 
            };
        } else {
            throw error;
        }
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
        
        // Initialize required files
        await initializeFiles();
        
        console.log('📋 Checking system state and dependencies...');

        const startTime = Date.now();
        const stats = {
            scrape: null,
            purge: null,
            cleanup: null,
            publish: null
        };
        
        try {
            // Load metadata with better error handling
            const metadataPath = getDataPath('metadata.json');
            let metadata = await loadMetadata();
            console.log('✅ Successfully loaded metadata');
            console.log(`📊 Current metadata state: ${Object.keys(metadata.books).length} books in database`);
            
            // Update cycle status
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
            
            // Check metadata after scraping
            metadata = await loadMetadata();
            console.log(`📊 Post-scrape metadata state: ${Object.keys(metadata.books).length} books in database`);
            console.log('✅ Scrape process completed successfully');
            
            console.log('\n🧹 Starting purge process...');
            console.log('🔍 Checking books against blacklist criteria...');
            const purgeResult = await purge();
            if (!purgeResult.success) {
                throw new Error(`Purge failed: ${purgeResult.error}`);
            }
            stats.purge = purgeResult.stats;
            
            // Check metadata after purging
            metadata = await loadMetadata();
            console.log(`📊 Post-purge metadata state: ${Object.keys(metadata.books).length} books in database`);
            console.log('✅ Purge process completed successfully');
            
            console.log('\n🧼 Starting cleanup process...');
            console.log('📊 Analyzing submission history and failures...');
            const cleanupResult = await cleanup();
            if (!cleanupResult.success) {
                throw new Error(`Cleanup failed: ${cleanupResult.error}`);
            }
            stats.cleanup = cleanupResult.stats;
            
            // Check metadata after cleanup
            metadata = await loadMetadata();
            console.log(`📊 Post-cleanup metadata state: ${Object.keys(metadata.books).length} books in database`);
            console.log('✅ Cleanup process completed successfully');
            
            console.log('\n📊 Starting publish process...');
            console.log('📝 Preparing leaderboard data...');
            const publishResult = await publish();
            if (!publishResult.success) {
                throw new Error(`Publish failed: ${publishResult.error}`);
            }
            stats.publish = publishResult.stats;
            
            // Check metadata after publishing
            metadata = await loadMetadata();
            console.log(`📊 Final metadata state: ${Object.keys(metadata.books).length} books in database`);
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
                const metadata = await loadMetadata();
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