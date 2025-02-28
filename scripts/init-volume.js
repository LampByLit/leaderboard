/**
 * Volume Initialization Module
 * ==========================
 * 
 * Responsible for initializing the data volume with required JSON files
 * and default configurations. Creates necessary data structures if they
 * don't exist while preserving existing data.
 * 
 * Files Created:
 * - input.json: Stores incoming submissions
 * - books.json: Maintains processed book data
 * - metadata.json: Stores system metadata and book processing state
 * - blacklist.json: Contains content filtering configuration
 * 
 * @module init-volume
 * @requires fs.promises
 * @requires path
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Default content templates for data files
 * Each file has a specific structure and purpose
 * @constant {Object}
 */
const DEFAULT_FILE_CONTENTS = {
    'input.json': {
        submissions: []
    },
    'books.json': {
        books: {},
        last_updated: new Date().toISOString()
    },
    'metadata.json': {
        limiter_enabled: true,
        books: {},
        last_update: new Date().toISOString()
    },
    'blacklist.json': {
        title_patterns: [],
        authors: [],
        patterns: [], // Keep for backward compatibility
        version: "2.0.0",
        last_updated: new Date().toISOString()
    }
};

/**
 * Initializes the data volume with required files and structures
 * Creates files if they don't exist, preserves existing ones
 * @async
 * @function initializeVolume
 * @returns {Promise<boolean>} True if initialization succeeds
 * @throws {Error} If initialization fails
 */
async function initializeVolume() {
    try {
        // Get the data directory from environment variable or use current directory
        const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
        console.log(`Initializing volume in: ${dataDir}`);

        // Ensure the data directory exists
        await fs.mkdir(dataDir, { recursive: true });

        // Initialize each file if it doesn't exist
        for (const [filename, defaultContent] of Object.entries(DEFAULT_FILE_CONTENTS)) {
            const filePath = path.join(dataDir, filename);
            try {
                // Check if file exists
                await fs.access(filePath);
                console.log(`${filename} already exists, skipping initialization`);
            } catch (error) {
                // File doesn't exist, create it with default content
                await fs.writeFile(
                    filePath,
                    JSON.stringify(defaultContent, null, 4)
                );
                console.log(`Created ${filename} with default content`);
            }
        }

        console.log('Volume initialization completed successfully');
        return true;
    } catch (error) {
        console.error('Error initializing volume:', error);
        throw error;
    }
}

// Export for use in server.js
module.exports = { initializeVolume }; 