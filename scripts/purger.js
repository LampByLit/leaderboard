/**
 * Content Purger Module
 * ====================
 * 
 * Responsible for filtering out inappropriate or blacklisted content from the book database.
 * Implements a multi-layer filtering system with both title and author checks.
 * 
 * Key Features:
 * - Multi-pattern content filtering
 * - Author blacklisting
 * - Conservative error handling (blocks on uncertainty)
 * - Atomic file operations with backups
 * - Detailed logging of purged content
 * 
 * Filtering Strategy:
 * 1. Title Pattern Matching - Checks for inappropriate keywords
 * 2. Author Blacklisting - Matches against known problematic authors
 * 3. Legacy Pattern Support - Maintains backward compatibility
 * 
 * @module purger
 * @requires fs.promises
 * @requires path
 */

const fs = require('fs').promises;
const path = require('path');

// Configure data directory
const DATA_DIR = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || './data');

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

/**
 * Normalizes a string for consistent comparison
 * Removes punctuation, extra spaces, and converts to lowercase
 * @param {string} str - The string to normalize
 * @returns {string} The normalized string
 */
function normalizeString(str) {
    if (!str) return '';
    return str.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Checks if a book's author matches a blacklisted author
 * Uses normalized string comparison for accuracy
 * @param {string} bookAuthor - The author to check
 * @param {string} blacklistAuthor - The blacklisted author to compare against
 * @returns {boolean} True if the authors match
 */
function isAuthorMatch(bookAuthor, blacklistAuthor) {
    if (!bookAuthor || !blacklistAuthor) return false;
    const normalizedBookAuthor = normalizeString(bookAuthor);
    const normalizedBlacklistAuthor = normalizeString(blacklistAuthor);
    return normalizedBookAuthor === normalizedBlacklistAuthor;
}

/**
 * Determines if a book should be filtered based on blacklist criteria
 * Implements multi-layer filtering with fallback to conservative blocking
 * @param {Object} book - The book object to check
 * @param {Object} blacklist - The blacklist configuration
 * @returns {boolean} True if the book should be filtered out
 */
function isBlacklisted(book, blacklist) {
    if (!book || !blacklist) return false;

    try {
        // Check author blacklist
        if (Array.isArray(blacklist.authors)) {
            const isAuthorBlacklisted = blacklist.authors.some(author => 
                isAuthorMatch(book.author, author)
            );
            if (isAuthorBlacklisted) {
                console.log(`🚫 Blacklisted author match: ${book.author}`);
                return true;
            }
        }

        // Check title patterns (new format)
        if (Array.isArray(blacklist.title_patterns) && book.title) {
            const normalizedTitle = book.title.toLowerCase();
            const matchedPattern = blacklist.title_patterns.find(pattern => 
                normalizedTitle.includes(pattern.toLowerCase())
            );
            if (matchedPattern) {
                console.log(`🚫 Blacklisted title pattern match: "${matchedPattern}" in "${book.title}"`);
                return true;
            }
        }

        // Backward compatibility: Check old patterns format
        if (Array.isArray(blacklist.patterns)) {
            for (const pattern of blacklist.patterns) {
                // Handle old title: prefix format
                if (pattern.startsWith("title:") && book.title) {
                    const titlePattern = pattern.slice(6).trim().toLowerCase();
                    if (book.title.toLowerCase().includes(titlePattern)) {
                        console.log(`🚫 Legacy title pattern match: "${titlePattern}" in "${book.title}"`);
                        return true;
                    }
                }
                // Handle old author pattern format
                else if (isAuthorMatch(book.author, pattern)) {
                    console.log(`🚫 Legacy author pattern match: ${book.author}`);
                    return true;
                }
            }
        }

        return false;
    } catch (error) {
        console.error('Error in isBlacklisted:', error);
        // In case of error, be conservative and return true to prevent potentially inappropriate content
        return true;
    }
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
            const blacklistData = await fs.readFile(blacklistPath, 'utf8');
            blacklist = JSON.parse(blacklistData);
            
            // Log blacklist configuration
            console.log(`🚫 Loaded blacklist configuration:
                - ${blacklist.authors?.length || 0} authors
                - ${blacklist.title_patterns?.length || 0} title patterns
                - ${blacklist.patterns?.length || 0} legacy patterns`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('⚠️ No blacklist.json found, using empty blacklist');
                blacklist = { 
                    authors: [], 
                    title_patterns: [], 
                    patterns: [] 
                };
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
            const isBookBlacklisted = isBlacklisted(book, blacklist);

            if (isBookBlacklisted) {
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