const fs = require('fs').promises;
const path = require('path');

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
    const logPath = path.join(__dirname, '..', 'cleanup_log.json');
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
    console.log('Starting submission cleanup...');
    
    try {
        // Load purge log
        const purgeLogPath = path.join(__dirname, '..', 'purge_log.json');
        const inputPath = path.join(__dirname, '..', 'input.json');
        
        // Track statistics
        const stats = {
            submissions_checked: 0,
            submissions_removed: 0,
            errors: 0
        };

        // Load and validate purge log
        let purgeLog;
        try {
            purgeLog = JSON.parse(await fs.readFile(purgeLogPath, 'utf8'));
            if (!Array.isArray(purgeLog.purged_entries)) {
                throw new Error('Invalid purge log format: expected purged_entries array');
            }
            console.log(`Loaded purge log with ${purgeLog.purged_entries.length} entries`);
        } catch (error) {
            console.error('Error loading purge log:', error);
            return { 
                success: false, 
                error: 'Failed to load purge log',
                stats 
            };
        }

        // Create Set of purged ASINs for efficient lookup
        const purgedASINs = new Set(
            purgeLog.purged_entries
                .map(entry => entry.asin)
                .filter(asin => asin)
        );
        console.log(`Found ${purgedASINs.size} unique purged ASINs`);

        // Load input.json
        let inputData;
        try {
            inputData = JSON.parse(await fs.readFile(inputPath, 'utf8'));
            if (!Array.isArray(inputData.submissions)) {
                throw new Error('Invalid input.json format: expected submissions array');
            }
            console.log(`Loaded input.json with ${inputData.submissions.length} submissions`);
        } catch (error) {
            console.error('Error loading input.json:', error);
            return { 
                success: false, 
                error: 'Failed to load input.json',
                stats 
            };
        }

        // Track removed submissions for logging
        const removedSubmissions = [];

        // Filter out submissions that match purged ASINs
        const originalCount = inputData.submissions.length;
        inputData.submissions = inputData.submissions.filter(submission => {
            stats.submissions_checked++;
            
            try {
                const asin = extractASIN(submission.url);
                if (!asin) {
                    console.warn(`Could not extract ASIN from URL: ${submission.url}`);
                    stats.errors++;
                    return true; // Keep entries we can't parse
                }

                if (purgedASINs.has(asin)) {
                    console.log(`Removing submission with purged ASIN: ${asin}`);
                    removedSubmissions.push(submission);
                    stats.submissions_removed++;
                    return false;
                }
                
                return true;
            } catch (error) {
                console.error('Error processing submission:', error);
                stats.errors++;
                return true; // Keep entries that cause errors
            }
        });

        // Only write if we removed something
        if (stats.submissions_removed > 0) {
            try {
                await safeWriteJSON(inputPath, inputData);
                console.log(`Successfully removed ${stats.submissions_removed} submissions`);
                
                // Log the cleanup operation
                await logCleanup(removedSubmissions);
            } catch (error) {
                console.error('Error saving cleaned input.json:', error);
                return { 
                    success: false, 
                    error: 'Failed to save cleaned input.json',
                    stats 
                };
            }
        } else {
            console.log('No submissions needed to be removed');
        }

        return { 
            success: true, 
            stats,
            removed_count: stats.submissions_removed
        };
    } catch (error) {
        console.error('Unexpected error during cleanup:', error);
        return { 
            success: false, 
            error: 'Internal error during cleanup operation',
            stats: { submissions_checked: 0, submissions_removed: 0, errors: 1 }
        };
    }
}

module.exports = { cleanup }; 