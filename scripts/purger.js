const fs = require('fs').promises;
const path = require('path');

// Configure data directory
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '.';

// Helper function to get data file paths
function getDataPath(filename) {
    return path.join(DATA_DIR, filename);
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

// Helper functions for blacklist matching
function normalizeString(str) {
    if (!str) return '';
    return str.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function isAuthorMatch(bookAuthor, blacklistAuthor) {
    if (!bookAuthor || !blacklistAuthor) return false;
    const normalizedAuthor = normalizeString(bookAuthor);
    const normalizedPattern = normalizeString(blacklistAuthor);
    return normalizedAuthor === normalizedPattern;
}

function isBlacklisted(book, pattern) {
    if (!book || !pattern) return false;
    // Check for author match
    if (isAuthorMatch(book.author, pattern)) {
        console.log(`Blacklisted author match: ${book.author}`);
        return true;
    }
    // Check for title match if pattern starts with "title:"
    if (pattern.startsWith("title:") && book.title) {
        const titlePattern = pattern.slice(6).trim();
        const isMatch = book.title.toLowerCase().includes(titlePattern.toLowerCase());
        if (isMatch) {
            console.log(`Blacklisted title match: ${book.title}`);
        }
        return isMatch;
    }
    return false;
}

async function purge() {
    try {
        console.log('\n🧹 Starting purge process...');
        
        // Read metadata.json
        const metadataPath = getDataPath('metadata.json');
        console.log('📖 Reading metadata...');
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        
        // Read blacklist.json
        const blacklistPath = getDataPath('blacklist.json');
        let blacklist;
        try {
            blacklist = JSON.parse(await fs.readFile(blacklistPath, 'utf8'));
            console.log(`🚫 Loaded ${blacklist.authors.length} authors from blacklist`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('⚠️ No blacklist.json found, using empty blacklist');
                blacklist = { authors: [] };
            } else {
                console.error('❌ Error reading blacklist:', error);
                throw error;
            }
        }

        // Process books
        console.log('\n📚 Checking books against blacklist...');
        const totalBooks = Object.keys(metadata.books).length;
        let checkedCount = 0;
        let purgedCount = 0;

        const purgedBooks = {};
        Object.entries(metadata.books).forEach(([asin, book]) => {
            checkedCount++;
            const isBlacklisted = blacklist.authors.some(pattern => {
                const regex = new RegExp(pattern, 'i');
                return regex.test(book.author) || regex.test(book.title);
            });

            if (isBlacklisted) {
                purgedCount++;
                console.log(`🚫 [${checkedCount}/${totalBooks}] Purged: "${book.title}" by ${book.author}`);
                purgedBooks[asin] = book;
            }
        });

        // Remove purged books from metadata
        Object.keys(purgedBooks).forEach(asin => {
            delete metadata.books[asin];
        });

        console.log(`\n📊 Summary: Purged ${purgedCount} books out of ${totalBooks} total`);
        
        // Save updated metadata
        console.log('💾 Saving updated metadata...');
        await safeWriteJSON(metadataPath, metadata);
        
        console.log('✅ Purge process completed successfully\n');
        return {
            success: true,
            stats: {
                total_books: totalBooks,
                purged_books: purgedCount,
                remaining_books: totalBooks - purgedCount,
                timestamp: new Date().toISOString()
            }
        };
    } catch (error) {
        console.error('❌ Purge process failed:', error);
        return {
            success: false,
            error: error.message || 'Unknown error during purge'
        };
    }
}

module.exports = { purge }; 