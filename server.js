const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { scrape } = require('./scripts/scraper');
const { publish } = require('./scripts/publisher');
const { purge } = require('./scripts/purger');
const { cleanup } = require('./scripts/cleaner');
const { cycle } = require('./scripts/cycle');

// Add process-level error handlers
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // Log the error but keep the process running
    console.error('Stack trace:', err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Log the error but keep the process running
    if (reason instanceof Error) {
        console.error('Stack trace:', reason.stack);
    }
});

const app = express();
const PORT = 3000;

// Middleware to parse JSON bodies
app.use(express.json());
// Serve static files from current directory
app.use(express.static('./'));

// Helper function for safe file writing with retries
async function safeWriteJSON(filePath, data, retries = 3) {
    const backupPath = `${filePath}.backup`;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // Create backup of current file if it exists
            try {
                const currentData = await fs.readFile(filePath, 'utf8');
                await fs.writeFile(backupPath, currentData);
            } catch (err) {
                // If file doesn't exist yet, that's fine
                if (err.code !== 'ENOENT') {
                    console.warn(`Warning: Could not create backup on attempt ${attempt}:`, err);
                    if (attempt === retries) throw err;
                    continue;
                }
            }

            // Write new data
            await fs.writeFile(filePath, JSON.stringify(data, null, 4));
            
            // Remove backup after successful write
            try {
                await fs.unlink(backupPath);
            } catch (err) {
                // Ignore if backup doesn't exist
                if (err.code !== 'ENOENT') {
                    console.warn('Warning: Could not remove backup file:', err);
                }
            }
            
            return; // Success - exit the retry loop
        } catch (error) {
            // If writing failed and we have a backup, restore from backup
            try {
                const backup = await fs.readFile(backupPath, 'utf8');
                await fs.writeFile(filePath, backup);
                console.error(`Error writing file on attempt ${attempt}, restored from backup:`, error);
                
                if (attempt === retries) {
                    throw new Error('Failed to write file after all retries');
                }
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            } catch (restoreError) {
                console.error(`Critical error on attempt ${attempt}: Could not restore from backup:`, restoreError);
                if (attempt === retries) {
                    throw restoreError;
                }
            }
        }
    }
}

// Helper function to check if user can submit today
async function canUserSubmitToday(ip) {
    try {
        const inputPath = path.join(__dirname, 'input.json');
        const data = await fs.readFile(inputPath, 'utf8');
        const json = JSON.parse(data);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const userSubmissionsToday = json.submissions.filter(submission => {
            const submissionDate = new Date(submission.submitted_at);
            submissionDate.setHours(0, 0, 0, 0);
            return submission.submitter_ip === ip && submissionDate.getTime() === today.getTime();
        });

        return userSubmissionsToday.length === 0;
    } catch (error) {
        console.error('Error checking submission limit:', error);
        return false;
    }
}

// Handle limiter toggle
let isLimiterEnabled = true;

app.post('/toggle-limiter', async (req, res) => {
    try {
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            return res.json({ 
                success: false, 
                error: 'Invalid toggle value' 
            });
        }
        
        isLimiterEnabled = enabled;
        console.log(`Limiter ${enabled ? 'enabled' : 'disabled'}`);
        
        // Update metadata to persist limiter state
        try {
            const metadataPath = path.join(__dirname, 'metadata.json');
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
            metadata.limiter_enabled = enabled;
            await safeWriteJSON(metadataPath, metadata);
        } catch (error) {
            console.error('Error persisting limiter state:', error);
            // Don't throw - just log the error and continue
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Toggle error:', error);
        res.json({ 
            success: false, 
            error: 'Failed to toggle limiter' 
        });
    }
});

// Handle URL submission
app.post('/submit-url', async (req, res) => {
    try {
        const { url, bypassLimiter } = req.body;
        const ip = req.ip || req.connection.remoteAddress;
        
        // Validate URL
        if (!url || !url.includes('amazon.com') || !url.includes('/dp/')) {
            return res.json({ success: false, error: 'Invalid Amazon URL' });
        }

        // Validate URL length
        if (url.length > 150) {
            return res.json({ success: false, error: 'URL is too long (maximum 150 characters)' });
        }

        // Check if user can submit today (skip if limiter is bypassed or globally disabled)
        if (!bypassLimiter && isLimiterEnabled) {
            try {
                const canSubmit = await canUserSubmitToday(ip);
                if (!canSubmit) {
                    return res.json({ 
                        success: false, 
                        error: 'You have already submitted a URL today. Please try again tomorrow.' 
                    });
                }
            } catch (error) {
                console.error('Error checking submission limit:', error);
                return res.json({ 
                    success: false, 
                    error: 'Could not verify submission limit. Please try again.' 
                });
            }
        }

        // Read current submissions with retry logic
        const inputPath = path.join(__dirname, 'input.json');
        let json;
        try {
            const data = await fs.readFile(inputPath, 'utf8');
            json = JSON.parse(data);
        } catch (error) {
            // If file doesn't exist or is invalid, start fresh
            if (error.code === 'ENOENT' || error instanceof SyntaxError) {
                json = { submissions: [] };
            } else {
                console.error('Error reading input.json:', error);
                return res.json({ 
                    success: false, 
                    error: 'Could not read submission data. Please try again.' 
                });
            }
        }

        // Check if URL already exists
        if (json.submissions.some(submission => submission.url === url)) {
            return res.json({ success: false, error: 'URL already submitted' });
        }

        // Add new submission
        const newSubmission = {
            url,
            submitted_at: new Date().toISOString(),
            submitter_ip: ip,
            limiter_bypassed: bypassLimiter
        };
        json.submissions.push(newSubmission);

        // Save back to file using safe write with retries
        try {
            await safeWriteJSON(inputPath, json);
            res.json({ success: true });
        } catch (error) {
            console.error('Error saving submission:', error);
            res.json({ 
                success: false, 
                error: 'Could not save submission. Please try again.' 
            });
        }
    } catch (error) {
        console.error('Submission error:', error);
        res.json({ 
            success: false, 
            error: 'Server error processing submission. Please try again.' 
        });
    }
});

// Handle update leaderboard
app.post('/update-leaderboard', async (req, res) => {
    try {
        console.log('Starting leaderboard update...');
        
        // Create a promise that resolves when scraping is done
        const scrapePromise = new Promise(async (resolve) => {
            try {
                // Run scraper with error handling
                let scrapeResult;
                try {
                    scrapeResult = await scrape();
                } catch (error) {
                    console.error('Scraper error:', error);
                    resolve({ 
                        success: false, 
                        error: 'Scraper failed: ' + (error.message || 'Unknown error') 
                    });
                    return;
                }

                if (!scrapeResult || !scrapeResult.success) {
                    resolve({ 
                        success: false, 
                        error: scrapeResult?.error || 'Scraper failed without error details'
                    });
                    return;
                }

                // Run publisher with error handling
                let publishResult;
                try {
                    publishResult = await publish();
                } catch (error) {
                    console.error('Publisher error:', error);
                    resolve({ 
                        success: false, 
                        error: 'Publisher failed: ' + (error.message || 'Unknown error')
                    });
                    return;
                }

                if (!publishResult || !publishResult.success) {
                    resolve({ 
                        success: false, 
                        error: publishResult?.error || 'Publisher failed without error details'
                    });
                    return;
                }

                console.log('Leaderboard update completed successfully');
                resolve({ success: true, books: publishResult.books });
            } catch (error) {
                console.error('Update error:', error);
                resolve({ 
                    success: false, 
                    error: 'Update failed: ' + (error.message || 'Unknown error'),
                    errorDetails: error.stack
                });
            }
        }).catch(error => {
            console.error('Unhandled promise rejection in scrape process:', error);
            return {
                success: false,
                error: 'Internal server error during scraping'
            };
        });

        // Set a timeout for the response
        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => {
                resolve({
                    success: true,
                    message: 'Scraping started in background. Check console for progress.'
                });
            }, 1000);
        });

        // Race between scrape completion and timeout
        const result = await Promise.race([scrapePromise, timeoutPromise]);
        res.json(result);

        // Continue scraping in background if not completed
        if (!result.books) {
            // Wrap the background process in error handling
            scrapePromise.then((finalResult) => {
                if (finalResult.success) {
                    console.log('Background scraping completed successfully');
                } else {
                    console.error('Background scraping failed:', finalResult.error);
                }
            }).catch(error => {
                console.error('Unhandled error in background scraping:', error);
            });
        }
    } catch (error) {
        console.error('Update error:', error);
        res.json({ 
            success: false, 
            error: 'Update failed: ' + (error.message || 'Unknown error'),
            errorDetails: error.stack
        });
    }
});

// Handle purge leaderboard
app.post('/purge-leaderboard', async (req, res) => {
    try {
        const result = await purge();
        if (!result.success) {
            return res.json({ success: false, error: result.error });
        }

        // Re-publish after purge
        const publishResult = await publish();
        if (!publishResult.success) {
            return res.json({ success: false, error: publishResult.error });
        }

        res.json({ success: true, books: publishResult.books });
    } catch (error) {
        console.error('Purge error:', error);
        res.json({ success: false, error: 'Purge failed' });
    }
});

// Rate limiter for publish endpoint
const publishRateLimiter = {
    attempts: new Map(),
    cleanupInterval: 5 * 60 * 1000, // Clean up every 5 minutes
    windowMs: 60 * 1000, // 1 minute window
    maxAttempts: 1, // 1 attempt per window

    isRateLimited(ip) {
        const now = Date.now();
        const attempts = this.attempts.get(ip) || [];
        
        // Filter out old attempts
        const recentAttempts = attempts.filter(timestamp => 
            now - timestamp < this.windowMs
        );
        
        // Update attempts
        this.attempts.set(ip, recentAttempts);
        
        return recentAttempts.length >= this.maxAttempts;
    },

    addAttempt(ip) {
        const attempts = this.attempts.get(ip) || [];
        attempts.push(Date.now());
        this.attempts.set(ip, attempts);
    },

    cleanup() {
        const now = Date.now();
        for (const [ip, attempts] of this.attempts.entries()) {
            const recentAttempts = attempts.filter(timestamp => 
                now - timestamp < this.windowMs
            );
            if (recentAttempts.length === 0) {
                this.attempts.delete(ip);
            } else {
                this.attempts.set(ip, recentAttempts);
            }
        }
    }
};

// Start cleanup interval
setInterval(() => {
    publishRateLimiter.cleanup();
}, publishRateLimiter.cleanupInterval);

// Handle publish leaderboard
app.post('/publish', async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    
    // Check rate limit
    if (publishRateLimiter.isRateLimited(ip)) {
        console.warn(`Rate limit exceeded for IP ${ip}`);
        return res.status(429).json({ 
            success: false, 
            error: 'Rate limit exceeded. Please wait before trying again.' 
        });
    }
    
    // Add attempt
    publishRateLimiter.addAttempt(ip);
    
    console.log('Starting publish operation...');
    
    try {
        const result = await publish();
        
        if (!result.success) {
            console.error('Publish failed:', result.error);
            return res.status(500).json({ 
                success: false, 
                error: result.error 
            });
        }

        console.log(`Publish completed successfully. Stats:`, result.stats);
        
        res.json({ 
            success: true, 
            stats: result.stats,
            message: `Successfully published ${result.stats.total_books} books to leaderboard`
        });
    } catch (error) {
        console.error('Unexpected error during publish:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during publish operation' 
        });
    }
});

// Handle blacklist purge
app.post('/purge', async (req, res) => {
    console.log('Starting blacklist purge...');
    
    try {
        const result = await purge();
        
        if (!result.success) {
            console.error('Purge failed:', result.error);
            return res.status(500).json({ 
                success: false, 
                error: result.error 
            });
        }

        console.log(`Purge completed successfully. Stats:`, result.stats);
        
        res.json({ 
            success: true, 
            stats: result.stats,
            purged_count: result.purged_books.length,
            message: `Successfully purged ${result.stats.purged} books`
        });
    } catch (error) {
        console.error('Unexpected error during purge:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during purge operation' 
        });
    }
});

// Handle cleanup of submissions
app.post('/cleanup', async (req, res) => {
    console.log('Starting submission cleanup...');
    
    try {
        const result = await cleanup();
        
        if (!result.success) {
            console.error('Cleanup failed:', result.error);
            return res.status(500).json({ 
                success: false, 
                error: result.error 
            });
        }

        console.log(`Cleanup completed successfully. Stats:`, result.stats);
        
        res.json({ 
            success: true, 
            stats: result.stats,
            removed_count: result.removed_count,
            message: `Successfully cleaned ${result.stats.submissions_removed} submissions`
        });
    } catch (error) {
        console.error('Unexpected error during cleanup:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during cleanup operation' 
        });
    }
});

// Handle cycle operation
app.post('/cycle', async (req, res) => {
    console.log('Starting cycle operation...');
    
    try {
        const result = await cycle();
        
        if (!result.success) {
            console.error('Cycle failed:', result.error);
            return res.status(500).json({ 
                success: false, 
                error: result.error,
                duration: result.duration
            });
        }

        console.log('Cycle completed successfully. Stats:', result.stats);
        
        res.json({ 
            success: true, 
            stats: result.stats,
            message: `Complete cycle finished successfully in ${result.stats.duration}`
        });
    } catch (error) {
        console.error('Unexpected error during cycle:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during cycle operation' 
        });
    }
});

// Add error handling middleware
app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// Enhance server error handling
const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
}).on('error', (error) => {
    console.error('Server error:', error);
    // Keep the server running unless it's a fatal error
    if (error.code === 'EADDRINUSE') {
        console.error('Port is already in use. Please choose a different port or wait a moment.');
        process.exit(1);
    }
});

// Keep the server running
server.keepAliveTimeout = 60000; // 60 seconds
server.headersTimeout = 65000; // 65 seconds

// Ignore SIGINT to keep server running
process.on('SIGINT', () => {
    console.log('SIGINT received - Ignoring shutdown signal to keep server running');
});

// Only handle SIGTERM for docker/deployment scenarios
process.on('SIGTERM', () => {
    console.log('SIGTERM received - Continuing to run');
}); 