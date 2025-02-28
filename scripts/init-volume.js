const fs = require('fs').promises;
const path = require('path');

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
        patterns: [],
        last_updated: new Date().toISOString()
    }
};

async function initializeVolume() {
    try {
        // Get the data directory from environment variable or use current directory
        const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || '.';
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