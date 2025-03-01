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
 * - Brownlist generation for rejected books
 * 
 * Filtering Strategy:
 * 1. Title Pattern Matching - Checks for inappropriate keywords with word boundaries
 * 2. Author Blacklisting - Matches against known problematic authors with flexible matching
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
 * Uses improved matching for better accuracy
 * @param {string} bookAuthor - The author to check
 * @param {string} blacklistAuthor - The blacklisted author to compare against
 * @returns {boolean} True if the authors match
 */
function isAuthorMatch(bookAuthor, blacklistAuthor) {
    if (!bookAuthor || !blacklistAuthor) return false;
    
    // Normalize both author names
    const normalizedBookAuthor = normalizeString(bookAuthor);
    const normalizedBlacklistAuthor = normalizeString(blacklistAuthor);
    
    // Check for exact match first
    if (normalizedBookAuthor === normalizedBlacklistAuthor) {
        console.log(`🎯 Exact author match: "${bookAuthor}" matches "${blacklistAuthor}"`);
        return true;
    }
    
    // Check if blacklisted author appears as a complete name in book author
    // This handles cases like "Adolf Hitler" in "The Speeches of Adolf Hitler"
    const blacklistWords = normalizedBlacklistAuthor.split(' ');
    if (blacklistWords.length > 1) {
        // Only check for full name matches (first and last name together)
        // This avoids matching common first names or last names independently
        if (normalizedBookAuthor.includes(normalizedBlacklistAuthor)) {
            console.log(`🎯 Full name match: "${blacklistAuthor}" found in "${bookAuthor}"`);
            return true;
        }
    }
    
    return false;
}

/**
 * Checks if a title contains a blacklisted pattern with word boundary checks
 * @param {string} title - The book title to check
 * @param {string} pattern - The blacklisted pattern to look for
 * @returns {boolean} True if the pattern is found with word boundaries
 */
function isTitlePatternMatch(title, pattern) {
    if (!title || !pattern) return false;
    
    const normalizedTitle = normalizeString(title);
    const normalizedPattern = normalizeString(pattern);
    
    // Create a regex with word boundaries to avoid matching substrings within words
    // This prevents matching "adult" in "adulteration" or "nigger" in "snigger"
    const regex = new RegExp(`\\b${normalizedPattern}\\b`, 'i');
    
    // Test if the pattern exists with word boundaries
    const isMatch = regex.test(normalizedTitle);
    
    if (isMatch) {
        console.log(`🎯 Title pattern match: "${pattern}" found in "${title}" with word boundaries`);
    }
    
    return isMatch;
}

/**
 * Determines if a book should be filtered based on blacklist criteria
 * Implements multi-layer filtering with fallback to conservative blocking
 * @param {Object} book - The book object to check
 * @param {Object} blacklist - The blacklist configuration
 * @returns {Object} Result object with isBlacklisted flag and reason
 */
function isBlacklisted(book, blacklist) {
    if (!book || !blacklist) return { isBlacklisted: false };

    try {
        // Check author blacklist
        if (Array.isArray(blacklist.authors)) {
            for (const author of blacklist.authors) {
                if (isAuthorMatch(book.author, author)) {
                    return {
                        isBlacklisted: true,
                        reason: `Blacklisted author: ${author}`,
                        matchedPattern: author,
                        matchType: 'author'
                    };
                }
            }
        }

        // Check title patterns (new format) with word boundary checks
        if (Array.isArray(blacklist.title_patterns) && book.title) {
            for (const pattern of blacklist.title_patterns) {
                if (isTitlePatternMatch(book.title, pattern)) {
                    return {
                        isBlacklisted: true,
                        reason: `Blacklisted title pattern: "${pattern}"`,
                        matchedPattern: pattern,
                        matchType: 'title_pattern'
                    };
                }
            }
        }

        // Backward compatibility: Check old patterns format
        if (Array.isArray(blacklist.patterns)) {
            for (const pattern of blacklist.patterns) {
                // Handle old title: prefix format
                if (pattern.startsWith("title:") && book.title) {
                    const titlePattern = pattern.slice(6).trim();
                    if (isTitlePatternMatch(book.title, titlePattern)) {
                        return {
                            isBlacklisted: true,
                            reason: `Legacy title pattern: "${titlePattern}"`,
                            matchedPattern: titlePattern,
                            matchType: 'legacy_title_pattern'
                        };
                    }
                }
                // Handle old author pattern format
                else if (isAuthorMatch(book.author, pattern)) {
                    return {
                        isBlacklisted: true,
                        reason: `Legacy author pattern: ${pattern}`,
                        matchedPattern: pattern,
                        matchType: 'legacy_author'
                    };
                }
            }
        }

        return { isBlacklisted: false };
    } catch (error) {
        console.error('Error in isBlacklisted:', error);
        // In case of error, be conservative and return true to prevent potentially inappropriate content
        return { 
            isBlacklisted: true, 
            reason: `Error during filtering: ${error.message}`,
            matchType: 'error'
        };
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
            console.log('📋 Loading blacklist configuration...');
            const blacklistData = await fs.readFile(blacklistPath, 'utf8');
            blacklist = JSON.parse(blacklistData);
            
            // Log blacklist configuration
            console.log(`\n📊 Blacklist Status:
    - ${blacklist.authors?.length || 0} authors blacklisted
    - ${blacklist.title_patterns?.length || 0} title patterns
    - ${blacklist.patterns?.length || 0} legacy patterns
    - Version: ${blacklist.version}
    - Last Updated: ${new Date(blacklist.last_updated).toLocaleString()}`);
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

        // Initialize brownlist
        const brownlistPath = getDataPath('brownlist.json');
        let brownlist;
        try {
            const brownlistData = await fs.readFile(brownlistPath, 'utf8');
            brownlist = JSON.parse(brownlistData);
            console.log(`📋 Loaded existing brownlist with ${Object.keys(brownlist.rejected_books).length} entries`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('📋 Creating new brownlist.json file');
                brownlist = {
                    version: '1.0.0',
                    last_updated: new Date().toISOString(),
                    rejected_books: {}
                };
            } else {
                console.error('❌ Error reading brownlist:', error);
                throw error;
            }
        }

        // Process books
        console.log('\n📚 Checking books against blacklist...');
        const totalBooks = Object.keys(metadata.books).length;
        let checkedCount = 0;
        let purgedCount = 0;

        const purgedBooks = {};
        console.log(`\n🔍 Scanning ${totalBooks} books...`);
        
        for (const [asin, book] of Object.entries(metadata.books)) {
            checkedCount++;
            const result = isBlacklisted(book, blacklist);

            if (result.isBlacklisted) {
                purgedCount++;
                console.log(`\n🚫 Found blacklisted book (${checkedCount}/${totalBooks}):
    Title: "${book.title}"
    Author: ${book.author}
    BSR: ${book.bsr.toLocaleString()}
    Reason: ${result.reason}`);
                
                purgedBooks[asin] = book;
                
                // Add to brownlist
                brownlist.rejected_books[asin] = {
                    title: book.title,
                    author: book.author,
                    url: book.url,
                    rejection_reason: result.reason,
                    matched_pattern: result.matchedPattern || '',
                    match_type: result.matchType || 'unknown',
                    timestamp: new Date().toISOString()
                };
            } else if (checkedCount % 10 === 0 || checkedCount === totalBooks) {
                // Progress update every 10 books
                console.log(`✓ Checked ${checkedCount}/${totalBooks} books...`);
            }
        }

        // Remove purged books from metadata
        if (purgedCount > 0) {
            console.log('\n🗑️ Removing purged books from database...');
            Object.keys(purgedBooks).forEach(asin => {
                delete metadata.books[asin];
            });
            console.log('✅ Purged books removed successfully');
            
            // Update brownlist timestamp
            brownlist.last_updated = new Date().toISOString();
            
            // Save brownlist
            console.log('💾 Saving brownlist with rejected books...');
            await safeWriteJSON(brownlistPath, brownlist);
            console.log(`✅ Brownlist saved with ${Object.keys(brownlist.rejected_books).length} total entries`);
        }

        console.log(`\n📊 Purge Summary:
    - Total Books Scanned: ${totalBooks}
    - Books Purged: ${purgedCount}
    - Clean Books: ${totalBooks - purgedCount}
    - Purge Rate: ${((purgedCount/totalBooks) * 100).toFixed(1)}%`);

        // Save updated metadata
        console.log('\n💾 Saving updated metadata...');
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