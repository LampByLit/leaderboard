const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { scrape } = require('./scripts/scraper');
const { publish } = require('./scripts/publisher');
const { purge } = require('./scripts/purger');
const { cleanup } = require('./scripts/cleaner');
const { cycle, isCycleLocked } = require('./scripts/cycle');
const { initializeVolume } = require('./scripts/init-volume');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Configure data directory
const DATA_DIR = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || './data');
console.log(`Using data directory: ${DATA_DIR}`);

// Track SSE clients with metadata
const clients = new Map();

// Message history system
const messageHistory = {
    messages: [],
    maxSize: 100, // Keep last 100 messages
    add(message) {
        this.messages.push(message);
        if (this.messages.length > this.maxSize) {
            this.messages.shift(); // Remove oldest message
        }
    }
};

// Store original console.log before any modifications
const originalConsoleLog = console.log.bind(console);

// Enhanced logging system
function enhancedLog(...args) {
    // Convert all arguments to strings and join them
    let message = args.map(arg => {
        if (typeof arg === 'object') {
            return JSON.stringify(arg, null, 2);
        }
        return String(arg);
    }).join(' ');

    // Format multi-line messages
    const formattedMessage = message.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join(' | ');

    // Use originalConsoleLog for actual logging
    originalConsoleLog(formattedMessage);

    // Create broadcast message
    const broadcastMessage = {
        type: 'log',
        message: formattedMessage,
        timestamp: new Date().toISOString()
    };

    // Add to history and broadcast to clients
    messageHistory.add(broadcastMessage);
    broadcastToClients(broadcastMessage);
}

// Override console.log with enhanced version
console.log = enhancedLog;

// Make enhancedLog available globally
global.enhancedLog = enhancedLog;

// Helper function to broadcast to all SSE clients
function broadcastToClients(data) {
    const payload = JSON.stringify({
        ...data,
        timestamp: new Date().toISOString(),
        connected_clients: clients.size
    });
    
    // Add to history if not already a historical message
    if (!data.type || data.type !== 'history') {
        messageHistory.add(data);
    }
    
    for (const [id, client] of clients.entries()) {
        try {
            client.res.write(`data: ${payload}\n\n`);
        } catch (error) {
            console.error(`❌ Error sending to client ${id}:`, error);
            disconnectClient(id);
        }
    }
}

// Helper function to disconnect a client
function disconnectClient(id) {
    const client = clients.get(id);
    if (client) {
        try {
            client.res.end();
        } catch (error) {
            console.error(`Error ending client ${id} connection:`, error);
        }
        clients.delete(id);
        console.log(`📡 Client ${id} disconnected (${clients.size} clients remaining)`);
        
        // Notify remaining clients about the disconnection
        broadcastToClients({
            status: 'system',
            message: `Client disconnected (${clients.size} connected)`,
            type: 'connection'
        });
    }
}

// Helper function to send progress to specific client
function sendProgressToClient(clientId, data) {
    const client = clients.get(clientId);
    if (client) {
        try {
            const payload = JSON.stringify({
                ...data,
                timestamp: new Date().toISOString(),
                client_id: clientId,
                connected_clients: clients.size
            });
            client.res.write(`data: ${payload}\n\n`);
        } catch (error) {
            console.error(`❌ Error sending to client ${clientId}:`, error);
            disconnectClient(clientId);
        }
    }
}

// Alias for backward compatibility
const sendProgressToClients = broadcastToClients;

// Helper function to get data file paths
function getDataPath(filename) {
    return path.join(DATA_DIR, filename);
}

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
const PORT = process.env.PORT || 3001;

// Initialize volume before starting server
async function startServer() {
    try {
        await initializeVolume();
        console.log('Volume initialized successfully');

        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Failed to initialize volume:', error);
        process.exit(1);
    }
}

// Middleware to parse JSON bodies
app.use(express.json());
// Serve static files from current directory
app.use(express.static('./'));

// Add new API endpoints
app.get('/api/data/input', async (req, res) => {
    try {
        const filePath = getDataPath('input.json');
        const data = await fs.readFile(filePath, 'utf8');
        const jsonData = JSON.parse(data);
        
        // Filter out sensitive information
        const sanitizedData = {
            submissions: jsonData.submissions.map(sub => ({
                url: sub.url,
                submitted_at: sub.submitted_at
            })),
            last_cleanup: jsonData.last_cleanup
        };
        
        res.json(sanitizedData);
    } catch (error) {
        console.error('Error reading input data:', error);
        res.status(500).json({ error: 'Failed to read input data' });
    }
});

app.get('/api/data/books', async (req, res) => {
    try {
        const filePath = getDataPath('books.json');
        const data = await fs.readFile(filePath, 'utf8');
        const jsonData = JSON.parse(data);
        
        // Filter out any sensitive information if needed
        const sanitizedData = {
            version: jsonData.version,
            last_updated: jsonData.last_updated,
            books: jsonData.books
        };
        
        res.json(sanitizedData);
    } catch (error) {
        console.error('Error reading books data:', error);
        res.status(500).json({ error: 'Failed to read books data' });
    }
});

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
        const inputPath = getDataPath('input.json');
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
            const metadataPath = getDataPath('metadata.json');
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
        const inputPath = getDataPath('input.json');
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

// Add cycle lock
let cycleInProgress = false;

// Handle update leaderboard
app.post('/update-leaderboard', async (req, res) => {
    if (cycleInProgress) {
        return res.json({
            success: false,
            error: 'A cycle operation is in progress. Please wait for it to complete.'
        });
    }

    try {
        console.log('Starting leaderboard update...');
        
                // Run scraper with error handling
                let scrapeResult;
                try {
                    scrapeResult = await scrape();
                } catch (error) {
                    console.error('Scraper error:', error);
            return res.json({ 
                        success: false, 
                        error: 'Scraper failed: ' + (error.message || 'Unknown error') 
                    });
                }

                if (!scrapeResult || !scrapeResult.success) {
            return res.json({ 
                        success: false, 
                        error: scrapeResult?.error || 'Scraper failed without error details'
                    });
                }

                // Run publisher with error handling
                let publishResult;
                try {
                    publishResult = await publish();
                } catch (error) {
                    console.error('Publisher error:', error);
            return res.json({ 
                        success: false, 
                        error: 'Publisher failed: ' + (error.message || 'Unknown error')
                    });
                }

                if (!publishResult || !publishResult.success) {
            return res.json({ 
                        success: false, 
                        error: publishResult?.error || 'Publisher failed without error details'
            });
        }

        console.log('Leaderboard update completed successfully');
        res.json({ success: true, books: publishResult.books });
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

// Get cycle status
app.get('/cycle-status', async (req, res) => {
    try {
        const metadataPath = getDataPath('metadata.json');
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        
        // Check if cycle is currently running
        const isLocked = await isCycleLocked();
        
        res.json({
            success: true,
            is_running: isLocked,
            cycle_status: metadata.cycle_status || { state: 'idle' }
        });
    } catch (error) {
        console.error('Error getting cycle status:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// Handle cycle operation
app.post('/cycle', async (req, res) => {
    console.log('\n🔄 Starting cycle operation...');
    
    try {
        // Check if cycle is already running
        const isLocked = await isCycleLocked();
        if (isLocked) {
            console.log('❌ Cycle is already running');
            return res.status(409).json({
                success: false, 
                error: 'A cycle is already in progress'
            });
        }
        
        const startTime = Date.now();
        let currentStage = 'init';
        let cycleStats = {
            scrape: { successful: 0, failed: 0 },
            purge: { removed: 0 },
            cleanup: { removed: 0 }
        };
        
        try {
            // Initialize cycle
            console.log('🚀 Initializing cycle process...');
            sendProgressToClients({ 
                status: 'starting', 
                message: '🚀 Initializing cycle process...',
                timestamp: new Date().toISOString()
            });
            
            // Update metadata
            const metadataPath = getDataPath('metadata.json');
            let metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
            metadata.cycle_status = {
                state: 'running',
                started_at: new Date().toISOString()
            };
            await safeWriteJSON(metadataPath, metadata);
            
            // Start scraping
            currentStage = 'scraping';
            console.log('📚 Starting scrape process...');
            sendProgressToClients({ 
                status: 'scraping', 
                message: '📚 Starting scrape process...',
                timestamp: new Date().toISOString()
            });
            
            const scrapeResult = await scrape((progress) => {
                sendProgressToClients({ 
                    status: 'scraping',
                    timestamp: new Date().toISOString(),
                    ...progress 
                });
            });
            
            if (!scrapeResult.success) {
                throw new Error(`Scrape failed: ${scrapeResult.error}`);
            }
            cycleStats.scrape = scrapeResult.stats;
            
            // Run purge
            currentStage = 'purging';
            console.log('🧹 Running purge process...');
            sendProgressToClients({ 
                status: 'purging', 
                message: '🧹 Running purge process...',
                timestamp: new Date().toISOString()
            });
            const purgeResult = await purge();
            if (!purgeResult.success) {
                throw new Error(`Purge failed: ${purgeResult.error}`);
            }
            cycleStats.purge = purgeResult.stats;
            sendProgressToClients({
                status: 'purging',
                message: '🧹 Purge process completed',
                timestamp: new Date().toISOString(),
                stats: purgeResult.stats
            });
            
            // Run cleanup
            currentStage = 'cleaning';
            console.log('🗑️ Running cleanup process...');
            sendProgressToClients({ 
                status: 'cleaning', 
                message: '🗑️ Running cleanup process...',
                timestamp: new Date().toISOString()
            });
            const cleanupResult = await cleanup();
            if (!cleanupResult.success) {
                throw new Error(`Cleanup failed: ${cleanupResult.error}`);
            }
            cycleStats.cleanup = cleanupResult.stats;
            sendProgressToClients({
                status: 'cleaning',
                message: '🗑️ Cleanup process completed',
                timestamp: new Date().toISOString(),
                stats: cleanupResult.stats
            });
            
            // Run publish
            currentStage = 'publishing';
            console.log('📝 Publishing results...');
            sendProgressToClients({ 
                status: 'publishing', 
                message: '📝 Publishing results...',
                timestamp: new Date().toISOString()
            });
            const publishResult = await publish();
            if (!publishResult.success) {
                throw new Error(`Publish failed: ${publishResult.error}`);
            }
            
            // Update metadata with completion status
            const duration = Date.now() - startTime;
            metadata.cycle_status = {
                state: 'completed',
                completed_at: new Date().toISOString(),
                duration: duration,
                stats: cycleStats
            };
            await safeWriteJSON(metadataPath, metadata);
            
            // Send completion message
            console.log('✨ Cycle completed successfully');
            sendProgressToClients({ 
                status: 'complete', 
                message: '✨ Cycle completed successfully',
                timestamp: new Date().toISOString(),
                stats: {
                    duration: `${(duration / 1000).toFixed(2)}s`,
                    successful_scrapes: cycleStats.scrape.successful_scrapes,
                    failed_scrapes: cycleStats.scrape.processed_urls - cycleStats.scrape.successful_scrapes,
                    purged: cycleStats.purge.removed || 0,
                    cleaned: cycleStats.cleanup.removed_submissions || 0,
                    total_remaining: cycleStats.cleanup.remaining_submissions || 0
                }
            });
            
            res.json({ success: true, stats: cycleStats });
        } catch (error) {
            console.error(`❌ Cycle failed during ${currentStage}:`, error);
            
            // Update metadata with failure status
            try {
                const duration = Date.now() - startTime;
                const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
                metadata.cycle_status = {
                    state: 'failed',
                    stage: currentStage,
                    error: error.message,
                    failed_at: new Date().toISOString(),
                    duration: duration,
                    partial_stats: cycleStats
                };
                await safeWriteJSON(metadataPath, metadata);
            } catch (statusError) {
                console.error('Failed to update cycle status:', statusError);
            }
            
            sendProgressToClients({ 
                status: 'error', 
                message: `Failed during ${currentStage}: ${error.message}`,
                timestamp: new Date().toISOString(),
                stage: currentStage
            });
            
            res.status(500).json({ 
                success: false, 
                error: error.message,
                stage: currentStage,
                partial_stats: cycleStats
            });
        }
    } catch (error) {
        console.error('❌ Critical cycle error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Critical error occurred during cycle operation'
        });
    }
});

// Add error handling middleware
app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// Enhance server error handling
startServer();

// Keep the server running
app.keepAliveTimeout = 65000; // 65 seconds
app.headersTimeout = 66000; // 66 seconds

// Ignore SIGINT to keep server running
process.on('SIGINT', () => {
    console.log('SIGINT received - Ignoring shutdown signal to keep server running');
});

// Only handle SIGTERM for docker/deployment scenarios
process.on('SIGTERM', () => {
    console.log('SIGTERM received - Continuing to run');
});

// Handle SSE connections
app.get('/progress', (req, res) => {
    const clientId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    console.log(`📡 New SSE connection established (Client ${clientId})`);
    
    // Set headers for SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    
    // Add client to the map with metadata
    clients.set(clientId, {
        res,
        connectedAt: new Date(),
        lastPing: Date.now()
    });
    
    // Send welcome message
    sendProgressToClient(clientId, {
        status: 'connected',
        message: `Connected as client ${clientId}`,
        type: 'welcome'
    });
    
    // Send message history
    messageHistory.messages.forEach(message => {
        sendProgressToClient(clientId, {
            ...message,
            type: 'history'
        });
    });
    
    // Notify all clients about the new connection
    broadcastToClients({
        status: 'system',
        message: `New client connected (${clients.size} total)`,
        type: 'connection'
    });
    
    // Handle client disconnect
    req.on('close', () => {
        disconnectClient(clientId);
    });
    
    // Handle errors
    res.on('error', (error) => {
        console.error(`❌ SSE connection error for client ${clientId}:`, error);
        disconnectClient(clientId);
    });
    
    // Set up ping interval for this client
    const pingInterval = setInterval(() => {
        const client = clients.get(clientId);
        if (client) {
            try {
                sendProgressToClient(clientId, {
                    status: 'ping',
                    timestamp: new Date().toISOString(),
                    type: 'heartbeat'
                });
                client.lastPing = Date.now();
            } catch (error) {
                console.error(`❌ Ping failed for client ${clientId}:`, error);
                clearInterval(pingInterval);
                disconnectClient(clientId);
            }
        } else {
            clearInterval(pingInterval);
        }
    }, 30000);
    
    // Clean up interval on disconnect
    req.on('close', () => {
        clearInterval(pingInterval);
    });
}); 