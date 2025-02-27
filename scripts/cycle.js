const fs = require('fs').promises;
const path = require('path');
const { scrape } = require('./scraper');
const { purge } = require('./purger');
const { cleanup } = require('./cleaner');
const { publish } = require('./publisher');

// Helper function to add delay between operations
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runs a complete cycle of operations:
 * 1. Scrape - Fetches latest data from Amazon
 * 2. Purge - Removes blacklisted authors
 * 3. Cleanup - Removes invalid submissions
 * 4. Publish - Updates the leaderboard
 */
async function cycle() {
    console.log('Starting complete cycle...');
    const startTime = Date.now();
    
    try {
        // 1. Scrape
        console.log('\n=== Starting Scrape Operation ===');
        const scrapeResult = await scrape();
        if (!scrapeResult.success) {
            throw new Error(`Scrape failed: ${scrapeResult.error}`);
        }
        console.log('Scrape completed successfully');
        
        // Small delay between operations
        await delay(1000);

        // 2. Purge
        console.log('\n=== Starting Purge Operation ===');
        const purgeResult = await purge();
        if (!purgeResult.success) {
            throw new Error(`Purge failed: ${purgeResult.error}`);
        }
        console.log('Purge completed successfully');
        
        await delay(1000);

        // 3. Cleanup
        console.log('\n=== Starting Cleanup Operation ===');
        const cleanupResult = await cleanup();
        if (!cleanupResult.success) {
            throw new Error(`Cleanup failed: ${cleanupResult.error}`);
        }
        console.log('Cleanup completed successfully');
        
        await delay(1000);

        // 4. Publish
        console.log('\n=== Starting Publish Operation ===');
        const publishResult = await publish();
        if (!publishResult.success) {
            throw new Error(`Publish failed: ${publishResult.error}`);
        }
        console.log('Publish completed successfully');

        // Calculate total duration
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        // Compile final stats
        const stats = {
            duration: `${duration}s`,
            scrape: scrapeResult.stats,
            purge: purgeResult.stats,
            cleanup: cleanupResult.stats,
            publish: publishResult.stats,
            timestamp: new Date().toISOString()
        };

        console.log(`\nComplete cycle finished successfully in ${duration} seconds`);
        
        return {
            success: true,
            stats
        };
    } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`Cycle failed after ${duration} seconds:`, error);
        return {
            success: false,
            error: error.message,
            duration: `${duration}s`
        };
    }
}

module.exports = { cycle }; 