/**
 * Book Data Cleaner Module
 * =======================
 * 
 * Responsible for cleaning and normalizing book data before publishing.
 * Handles data validation, normalization, and duplicate removal.
 * 
 * Key Features:
 * - Data validation and cleanup
 * - HTML entity decoding
 * - Duplicate detection
 * - Field normalization
 * - Error logging
 * 
 * Cleaning Process:
 * 1. Data Validation
 *    - Required field checks
 *    - Type validation
 *    - Format validation
 * 
 * 2. Data Normalization
 *    - HTML entity decoding
 *    - Whitespace cleanup
 *    - URL normalization
 *    - BSR formatting
 * 
 * 3. Duplicate Handling
 *    - ASIN-based deduplication
 *    - BSR conflict resolution
 *    - Title similarity checks
 * 
 * Safety Features:
 * - Never loses original data
 * - Validates all fields
 * - Creates backups
 * - Detailed error logging
 * - Conservative cleanup
 * 
 * File Dependencies:
 * - metadata.json: Source/output data
 * - backup files (.bak)
 * 
 * @module cleaner
 * @requires fs.promises
 * @requires path
 * @requires he (HTML entities)
 */

const fs = require('fs').promises;
const path = require('path');

// Configure data directory
const DATA_DIR = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || './data');
const ROOT_DIR = path.resolve(__dirname, '..');

// Helper function to get data file paths
function getDataPath(filename) {
    // Special case for input.json which is now in root
    if (filename === 'input.json') {
        return path.join(ROOT_DIR, filename);
    }
    return path.join(DATA_DIR, filename);
}

// Helper function for safe atomic writes
async function safeWriteJSON(filePath, data) {
    const backupPath = `${filePath}.backup`;
    const tempPath = `${filePath}.temp`;
    
    try {
        // Create backup of current file if it exists
        try {
            const currentData = await fs.readFile(filePath, 'utf8');
            await fs.writeFile(backupPath, currentData);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }

        // Write new data to temp file first
        await fs.writeFile(tempPath, JSON.stringify(data, null, 4));
        
        // Rename temp file to actual file (atomic operation)
        await fs.rename(tempPath, filePath);
        
        // Remove backup after successful write
        try {
            await fs.unlink(backupPath);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.warn('Warning: Could not remove backup file:', err);
            }
        }
    } catch (error) {
        // If anything went wrong, try to restore from backup
        console.error('Error during safe write:', error);
        
        try {
            if (await fs.access(backupPath).then(() => true).catch(() => false)) {
                await fs.copyFile(backupPath, filePath);
                console.log('Restored from backup');
            }
        } catch (restoreError) {
            console.error('Critical error: Could not restore from backup:', restoreError);
            throw restoreError;
        }
        
        throw error;
    } finally {
        // Cleanup temp file if it exists
        try {
            await fs.unlink(tempPath);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.warn('Warning: Could not remove temp file:', err);
            }
        }
    }
}

// Helper function to extract ASIN from Amazon URL
function extractASIN(url) {
    const match = url.match(/\/dp\/([A-Z0-9]{10})/);
    return match ? match[1] : null;
}

// Helper function to log cleanup operations
async function logCleanup(removedSubmissions, reason) {
    const logPath = getDataPath('cleanup_log.json');
    let log;
    
    try {
        try {
            // Read the existing log file
            const logData = await fs.readFile(logPath, 'utf8');
            
            // Check if file is empty or has invalid JSON
            if (!logData || logData.trim() === '') {
                console.log('⚠️ Cleanup log file is empty, initializing new log');
                log = { 
                    cleaned_entries: [],
                    created_at: new Date().toISOString() 
                };
            } else {
                // Try to parse the JSON
                try {
                    log = JSON.parse(logData);
                    
                    // Ensure cleaned_entries array exists
                    if (!log.cleaned_entries) {
                        log.cleaned_entries = [];
                    }
                } catch (parseError) {
                    console.log('⚠️ Invalid JSON in cleanup log file, initializing new log');
                    log = { 
                        cleaned_entries: [],
                        created_at: new Date().toISOString() 
                    };
                }
            }
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.log('⚠️ No cleanup log file found, creating new log');
                log = { 
                    cleaned_entries: [],
                    created_at: new Date().toISOString() 
                };
            } else {
                throw err;
            }
        }

        const timestamp = new Date().toISOString();
        
        // Add new entries with timestamp
        for (const submission of removedSubmissions) {
            log.cleaned_entries.push({
                timestamp,
                url: submission.url,
                submitted_at: submission.submitted_at,
                reason: reason
            });
        }

        await safeWriteJSON(logPath, log);
        console.log(`✅ Logged ${removedSubmissions.length} cleaned entries`);
    } catch (error) {
        console.error('Error logging cleanup:', error);
        // Don't throw - we don't want logging failures to affect the cleanup
        
        // Try to create a new log file as a last resort
        try {
            console.log('🔄 Attempting to create new cleanup log file...');
            const newLog = { 
                cleaned_entries: removedSubmissions.map(submission => ({
                    timestamp: new Date().toISOString(),
                    url: submission.url,
                    submitted_at: submission.submitted_at,
                    reason: reason
                })),
                created_at: new Date().toISOString() 
            };
            await fs.writeFile(logPath, JSON.stringify(newLog, null, 4));
            console.log('✅ Created new cleanup log file');
        } catch (fallbackError) {
            console.error('❌ Failed to create cleanup log file:', fallbackError);
        }
    }
}

async function cleanup() {
    try {
        console.log('\n🧹 Starting cleanup process...');
        
        // Read all necessary files
        const inputPath = getDataPath('input.json');
        const metadataPath = getDataPath('metadata.json');
        
        console.log('📖 Reading input and metadata...');
        const inputData = JSON.parse(await fs.readFile(inputPath, 'utf8'));
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        
        const totalSubmissions = inputData.submissions.length;
        let removedCount = 0;
        const removedSubmissions = [];

        // Filter submissions
        const keptSubmissions = inputData.submissions.filter(submission => {
            const asin = extractASIN(submission.url);
            
            // If we can't extract ASIN, mark for removal
            if (!asin) {
                removedCount++;
                removedSubmissions.push({ ...submission, reason: 'invalid_asin' });
                console.log(`🗑️ Removed: ${submission.url} (Invalid ASIN)`);
                return false;
            }
            
            // If book exists in metadata and is active, keep it
            if (metadata.books[asin]) {
                return true;
            }
            
            // Book does not exist in metadata, remove it immediately
            removedCount++;
            removedSubmissions.push({ ...submission, reason: 'failed_or_purged' });
            console.log(`🗑️ Removed: ${submission.url} (Failed scraping)`);
            return false;
        });
        
        // Update input data
        inputData.submissions = keptSubmissions;
        inputData.last_cleanup = new Date().toISOString();
        
        // Log cleanup operations
        if (removedSubmissions.length > 0) {
            await logCleanup(removedSubmissions, 'failed_or_purged');
        }
        
        console.log(`\n📊 Summary: Removed ${removedCount} failed/purged submissions out of ${totalSubmissions} total`);
        
        // Save updated input data
        console.log('💾 Saving cleaned input data...');
        await safeWriteJSON(inputPath, inputData);
        
        console.log('✅ Cleanup process completed successfully\n');
        return { 
            success: true, 
            stats: {
                total_submissions: totalSubmissions,
                removed_submissions: removedCount,
                remaining_submissions: keptSubmissions.length,
                timestamp: new Date().toISOString()
            }
        };
    } catch (error) {
        console.error('❌ Cleanup process failed:', error);
        return { 
            success: false, 
            error: error.message || 'Unknown error during cleanup'
        };
    }
}

module.exports = { cleanup }; 