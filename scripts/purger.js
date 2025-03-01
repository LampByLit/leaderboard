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
 * - Brownlist creation for rejected books
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
 * Enhanced author matching with support for name variations
 * Checks for exact matches and also handles cases with middle names/initials
 * @param {string} bookAuthor - The author to check
 * @param {string} blacklistAuthor - The blacklisted author to compare against
 * @returns {boolean} True if the authors match
 */
function isAuthorMatch(bookAuthor, blacklistAuthor) {
    if (!bookAuthor || !blacklistAuthor) return false;
    
    // Normalize both strings
    const normalizedBookAuthor = normalizeString(bookAuthor);
    const normalizedBlacklistAuthor = normalizeString(blacklistAuthor);
    
    // Exact match check
    if (normalizedBookAuthor === normalizedBlacklistAuthor) {
        console.log(`🔍 Author exact match: "${bookAuthor}" matches "${blacklistAuthor}"`);
        return true;
    }
    
    // Partial name match (for cases with middle names/initials)
    const bookAuthorParts = normalizedBookAuthor.split(' ');
    const blacklistAuthorParts = normalizedBlacklistAuthor.split(' ');
    
    // Check if first and last names match when there are multiple parts
    if (bookAuthorParts.length >= 2 && blacklistAuthorParts.length >= 2) {
        const bookFirstLast = [bookAuthorParts[0], bookAuthorParts[bookAuthorParts.length - 1]].join(' ');
        const blacklistFirstLast = [blacklistAuthorParts[0], blacklistAuthorParts[blacklistAuthorParts.length - 1]].join(' ');
        
        if (bookFirstLast === blacklistFirstLast) {
            console.log(`🔍 Author partial match: "${bookAuthor}" matches "${blacklistAuthor}" (first/last name)`);
            return true;
        }
    }
    
    return false;
}

/**
 * Enhanced title pattern matching with word boundary checks
 * @param {string} title - The book title to check
 * @param {Array<string>} patterns - List of blacklisted patterns
 * @returns {boolean} True if the title contains a blacklisted pattern
 */
function isTitlePatternMatch(title, patterns) {
    if (!title || !patterns || !Array.isArray(patterns)) return false;
    
    const normalizedTitle = title.toLowerCase();
    
    for (const pattern of patterns) {
        // Simple contains check for short patterns (less than 4 chars)
        if (pattern.length < 4) {
            if (normalizedTitle.includes(pattern.toLowerCase())) {
                console.log(`🚫 Title pattern match (simple): "${pattern}" in "${title}"`);
                return true;
            }
        } else {
            // Use word boundary check for longer patterns to avoid false positives
            try {
                const regex = new RegExp(`\\b${pattern.toLowerCase()}\\b`, 'i');
                if (regex.test(normalizedTitle)) {
                    console.log(`🚫 Title pattern match (word boundary): "${pattern}" in "${title}"`);
                    return true;
                }
            } catch (error) {
                // Fallback to simple contains if regex fails (e.g., for special characters)
                if (normalizedTitle.includes(pattern.toLowerCase())) {
                    console.log(`🚫 Title pattern match (fallback): "${pattern}" in "${title}"`);
                    return true;
                }
            }
        }
    }
    
    return false;
}

/**
 * Log detailed information about filtering decisions
 * @param {Object} book - The book being checked
 * @param {boolean} isFiltered - Whether the book was filtered
 * @param {string} reason - The reason for the decision
 */
function logFilterDecision(book, isFiltered, reason) {
    const status = isFiltered ? '🚫 FILTERED' : '✅ KEPT';
    console.log(`${status}: "${book.title}" by ${book.author}`);
    console.log(`   BSR: ${book.bsr.toLocaleString()}`);
    console.log(`   Reason: ${reason}`);
    console.log(`   URL: ${book.url}`);
    console.log('-----------------------------------');
}

/**
 * Add a rejected book to the brownlist
 * @param {Object} book - The rejected book
 * @param {string} reason - The reason for rejection
 */
async function addToBrownlist(book, reason) {
    const brownlistPath = getDataPath('brownlist.json');
    let brownlist;
    
    try {
        try {
            brownlist = JSON.parse(await fs.readFile(brownlistPath, 'utf8'));
        } catch (err) {
            if (err.code === 'ENOENT') {
                brownlist = { 
                    rejected_books: [],
                    last_updated: new Date().toISOString(),
                    version: "1.0.0"
                };
                console.log('📝 Creating new brownlist.json file');
            } else {
                throw err;
            }
        }
        
        // Add the rejected book with timestamp and reason
        brownlist.rejected_books.push({
            title: book.title,
            author: book.author,
            url: book.url,
            bsr: book.bsr,
            asin: book.asin,
            rejected_at: new Date().toISOString(),
            reason: reason
        });
        
        // Update last_updated timestamp
        brownlist.last_updated = new Date().toISOString();
        
        // Save the updated brownlist
        await safeWriteJSON(brownlistPath, brownlist);
        console.log(`📝 Added to brownlist: "${book.title}" by ${book.author}`);
    } catch (error) {
        console.error('Error updating brownlist:', error);
    }
}

/**
 * Determines if a book should be filtered based on blacklist criteria
 * Implements multi-layer filtering with fallback to conservative blocking
 * @param {Object} book - The book object to check
 * @param {Object} blacklist - The blacklist configuration
 * @returns {Object} Result with isBlacklisted flag and reason
 */
function isBlacklisted(book, blacklist) {
    if (!book || !blacklist) return { isBlacklisted: false, reason: 'Invalid input' };

    try {
        // Check author blacklist
        if (Array.isArray(blacklist.authors)) {
            const blacklistedAuthor = blacklist.authors.find(author => 
                isAuthorMatch(book.author, author)
            );
            
            if (blacklistedAuthor) {
                return { 
                    isBlacklisted: true, 
                    reason: `Blacklisted author: ${blacklistedAuthor}` 
                };
            }
        }

        // Check title patterns (new format)
        if (Array.isArray(blacklist.title_patterns) && book.title) {
            if (isTitlePatternMatch(book.title, blacklist.title_patterns)) {
                return { 
                    isBlacklisted: true, 
                    reason: 'Blacklisted title pattern' 
                };
            }
        }

        // Backward compatibility: Check old patterns format
        if (Array.isArray(blacklist.patterns)) {
            for (const pattern of blacklist.patterns) {
                // Handle old title: prefix format
                if (pattern.startsWith("title:") && book.title) {
                    const titlePattern = pattern.slice(6).trim();
                    if (book.title.toLowerCase().includes(titlePattern.toLowerCase())) {
                        return { 
                            isBlacklisted: true, 
                            reason: `Legacy title pattern: ${titlePattern}` 
                        };
                    }
                }
                // Handle old author pattern format
                else if (isAuthorMatch(book.author, pattern)) {
                    return { 
                        isBlacklisted: true, 
                        reason: `Legacy author pattern: ${pattern}` 
                    };
                }
            }
        }

        return { isBlacklisted: false, reason: 'Passed all checks' };
    } catch (error) {
        console.error('Error in isBlacklisted:', error);
        // In case of error, be conservative and return true to prevent potentially inappropriate content
        return { 
            isBlacklisted: true, 
            reason: `Error during check: ${error.message}` 
        };
    }
}

async function purge() {
    try {
        console.log('\n🧹 Starting purge process...');
        console.log('⏱️ ' + new Date().toISOString());
        
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
    - Version: ${blacklist.version || 'unknown'}
    - Last Updated: ${blacklist.last_updated ? new Date(blacklist.last_updated).toLocaleString() : 'unknown'}`);
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

        console.log(`\n🔍 Scanning ${totalBooks} books...`);
        
        // Create a copy of the books to avoid modification during iteration
        const bookEntries = Object.entries(metadata.books);
        
        for (const [asin, book] of bookEntries) {
            checkedCount++;
            
            // Skip books without required fields
            if (!book.title || !book.author) {
                console.log(`⚠️ Skipping book with missing data: ${asin}`);
                continue;
            }
            
            const result = isBlacklisted(book, blacklist);

            if (result.isBlacklisted) {
                purgedCount++;
                console.log(`\n🚫 Found blacklisted book (${checkedCount}/${totalBooks}):`);
                console.log(`   Title: "${book.title}"`);
                console.log(`   Author: ${book.author}`);
                console.log(`   BSR: ${book.bsr.toLocaleString()}`);
                console.log(`   Reason: ${result.reason}`);
                
                // Add to brownlist before removing
                await addToBrownlist(book, result.reason);
                
                // Remove from metadata
                delete metadata.books[asin];
            } else {
                // Log decision for kept books (less verbose)
                if (checkedCount % 10 === 0 || checkedCount === totalBooks) {
                    console.log(`✓ Checked ${checkedCount}/${totalBooks} books...`);
                }
            }
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