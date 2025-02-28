/**
 * Submission Cleaner
 * ================
 * 
 * Maintains the health of the submission pool by removing invalid or consistently failing entries.
 * Acts as the first line of defense in the update cycle.
 * 
 * Cleaning Rules:
 * - Remove entries with invalid ASINs
 * - Remove entries that fail scraping 3 times
 * - Remove blacklisted entries
 * - Keep successful entries (reset failure count)
 * 
 * Features:
 * - Failure tracking with retry limits
 * - Atomic file operations
 * - Operation logging
 * - Backup creation before modifications
 * 
 * File Dependencies:
 * - input.json: Source of submissions
 * - metadata.json: Book data and state
 * - cleanup_log.json: Operation history
 * 
 * Safety Measures:
 * - Atomic writes with rollback
 * - Backup files before modifications
 * - Validation before removal
 * 
 * @module cleaner
 */

const fs = require('fs').promises;
const path = require('path');

// Configure data directory
const DATA_DIR = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || './data');

// Helper function to get data file paths
function getDataPath(filename) {
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
            log = JSON.parse(await fs.readFile(logPath, 'utf8'));
        } catch (err) {
            if (err.code === 'ENOENT') {
                log = { cleaned_entries: [] };
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
    } catch (error) {
        console.error('Error logging cleanup:', error);
        // Don't throw - we don't want logging failures to affect the cleanup
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
                
            // Initialize or increment failed attempts counter
            submission.failed_attempts = (submission.failed_attempts || 0) + 1;
            
            // If book exists in metadata and is active, reset failed attempts and keep it
            if (metadata.books[asin]) {
                submission.failed_attempts = 0;
                return true;
            }
            
            // Only remove if it has failed 3 or more times
            if (submission.failed_attempts >= 3) {
                removedCount++;
                removedSubmissions.push({ ...submission, reason: 'failed_or_purged' });
                console.log(`🗑️ Removed: ${submission.url} (Failed scraping ${submission.failed_attempts} times)`);
                return false;
            }
            
            // Keep it but increment the failed counter
            console.log(`⚠️ Keeping: ${submission.url} (Failed attempt ${submission.failed_attempts}/3)`);
            return true;
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