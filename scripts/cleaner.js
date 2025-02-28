const fs = require('fs').promises;
const path = require('path');

// Configure data directory
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '.';

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
async function logCleanup(removedSubmissions) {
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
                reason: 'previously_purged'
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
        
        // Read input.json
        const inputPath = getDataPath('input.json');
        console.log('📖 Reading input data...');
        const inputData = JSON.parse(await fs.readFile(inputPath, 'utf8'));
        
        // Get current time
        const now = new Date();
        const DAYS_TO_KEEP = 7;
        console.log(`\n⏳ Checking for submissions older than ${DAYS_TO_KEEP} days...`);
        
        // Process submissions
        const totalSubmissions = inputData.submissions.length;
        let checkedCount = 0;
        let removedCount = 0;
        
        const keptSubmissions = inputData.submissions.filter(submission => {
            checkedCount++;
            const submissionDate = new Date(submission.submitted_at);
            const daysSinceSubmission = (now - submissionDate) / (1000 * 60 * 60 * 24);
            
            if (daysSinceSubmission > DAYS_TO_KEEP) {
                removedCount++;
                console.log(`🗑️ [${checkedCount}/${totalSubmissions}] Removed: ${submission.url} (${Math.floor(daysSinceSubmission)} days old)`);
                return false;
            }
            return true;
        });
        
        // Update input data
        inputData.submissions = keptSubmissions;
        inputData.last_cleanup = now.toISOString();
        
        console.log(`\n📊 Summary: Removed ${removedCount} submissions out of ${totalSubmissions} total`);
        
        // Save updated input data
        console.log('💾 Saving cleaned input data...');
        await safeWriteJSON(inputPath, inputData);
        
        console.log('✅ Cleanup process completed successfully\n');
        return {
            success: true,
            stats: {
                total_submissions: totalSubmissions,
                removed_submissions: removedCount,
                remaining_submissions: totalSubmissions - removedCount,
                timestamp: now.toISOString()
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