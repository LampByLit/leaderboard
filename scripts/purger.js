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
 * - Brownlist tracking of rejected books
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
 * Helper function to escape special regex characters
 * @param {string} string - The string to escape
 * @returns {string} The escaped string
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Enhanced function to check if a book's author matches a blacklisted author
 * Uses multiple matching strategies for better accuracy
 * @param {string} bookAuthor - The author to check
 * @param {string} blacklistAuthor - The blacklisted author to compare against
 * @returns {boolean} True if the authors match
 */
function isAuthorMatch(bookAuthor, blacklistAuthor) {
    if (!bookAuthor || !blacklistAuthor) return false;
    
    // Normalize both strings
    const normalizedBookAuthor = normalizeString(bookAuthor);
    const normalizedBlacklistAuthor = normalizeString(blacklistAuthor);
    
    // Direct match
    if (normalizedBookAuthor === normalizedBlacklistAuthor) {
        console.log(`Direct author match: "${bookAuthor}" matches "${blacklistAuthor}"`);
        return true;
    }
    
    // Check if blacklisted author is contained within book author
    if (normalizedBookAuthor.includes(normalizedBlacklistAuthor)) {
        console.log(`Partial author match: "${bookAuthor}" contains "${blacklistAuthor}"`);
        return true;
    }
    
    // Check if book author is contained within blacklisted author
    if (normalizedBlacklistAuthor.includes(normalizedBookAuthor)) {
        console.log(`Partial author match: "${blacklistAuthor}" contains "${bookAuthor}"`);
        return true;
    }
    
    // Check for name parts (first name, last name)
    const bookAuthorParts = normalizedBookAuthor.split(' ');
    const blacklistAuthorParts = normalizedBlacklistAuthor.split(' ');
    
    // Check if last names match (assuming last part is last name)
    if (bookAuthorParts.length > 0 && blacklistAuthorParts.length > 0) {
        const bookLastName = bookAuthorParts[bookAuthorParts.length - 1];
        const blacklistLastName = blacklistAuthorParts[blacklistAuthorParts.length - 1];
        
        if (bookLastName === blacklistLastName && bookLastName.length > 3) {
            console.log(`Last name match: "${bookAuthor}" and "${blacklistAuthor}" share last name "${bookLastName}"`);
            return true;
        }
    }
    
    return false;
}

/**
 * Enhanced function to check if a book title contains blacklisted patterns
 * @param {string} bookTitle - The title to check
 * @param {Array<string>} titlePatterns - Array of blacklisted title patterns
 * @returns {Object} Result object with isBlacklisted flag and matchedPattern
 */
function isTitleBlacklisted(bookTitle, titlePatterns) {
    if (!bookTitle || !Array.isArray(titlePatterns)) {
        return { isBlacklisted: false, matchedPattern: null };
    }
    
    const normalizedTitle = normalizeString(bookTitle);
    
    for (const pattern of titlePatterns) {
        const normalizedPattern = normalizeString(pattern);
        
        // Skip empty patterns
        if (!normalizedPattern) continue;
        
        // Check for exact pattern match
        if (normalizedTitle.includes(normalizedPattern)) {
            console.log(`Title pattern match: "${pattern}" found in "${bookTitle}"`);
            return {
                isBlacklisted: true,
                matchedPattern: pattern
            };
        }
        
        // Check for word boundary match (to avoid matching substrings within words)
        try {
            const wordBoundaryRegex = new RegExp(`\\b${escapeRegExp(normalizedPattern)}\\b`, 'i');
            if (wordBoundaryRegex.test(normalizedTitle)) {
                console.log(`Word boundary title match: "${pattern}" found as whole word in "${bookTitle}"`);
                return {
                    isBlacklisted: true,
                    matchedPattern: pattern
                };
            }
        } catch (error) {
            console.error(`Error creating regex for pattern "${pattern}":`, error);
        }
    }
    
    return {
        isBlacklisted: false,
        matchedPattern: null
    };
}

/**
 * Logs detailed information about a purged book
 * @param {Object} book - The book object being purged
 * @param {string} reason - The reason for purging
 * @param {string} matchedPattern - The pattern that triggered the purge
 */
function logPurgeAction(book, reason, matchedPattern) {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] 🚫 PURGED: "${book.title}" by ${book.author}`);
    console.log(`  Reason: ${reason}`);
    console.log(`  Matched Pattern: "${matchedPattern}"`);
    console.log(`  BSR: ${book.bsr?.toLocaleString() || 'N/A'}`);
    console.log(`  URL: ${book.url || 'N/A'}`);
    console.log(`  ASIN: ${book.asin || 'N/A'}`);
}

/**
 * Adds a rejected book to the brownlist.json file
 * @param {Object} book - The book object being rejected
 * @param {string} reason - The reason for rejection
 * @param {string} matchedPattern - The pattern that triggered the rejection
 */
async function addToBrownlist(book, reason, matchedPattern) {
    const brownlistPath = getDataPath('brownlist.json');
    let brownlist;
    
    try {
        try {
            brownlist = JSON.parse(await fs.readFile(brownlistPath, 'utf8'));
        } catch (err) {
            if (err.code === 'ENOENT') {
                brownlist = {
                    version: "1.0.0",
                    last_updated: new Date().toISOString(),
                    rejected_books: []
                };
            } else {
                throw err;
            }
        }
        
        // Add the rejected book to the brownlist
        brownlist.rejected_books.push({
            asin: book.asin,
            title: book.title,
            author: book.author,
            url: book.url,
            bsr: book.bsr,
            rejection_reason: reason,
            matched_pattern: matchedPattern,
            timestamp: new Date().toISOString()
        });
        
        // Update last_updated timestamp
        brownlist.last_updated = new Date().toISOString();
        
        // Save the updated brownlist
        await safeWriteJSON(brownlistPath, brownlist);
        
        console.log(`✅ Added to brownlist: "${book.title}" by ${book.author}`);
    } catch (error) {
        console.error(`❌ Error adding to brownlist: ${error.message}`);
    }
}

/**
 * Enhanced function to determine if a book should be filtered based on blacklist criteria
 * Implements multi-layer filtering with detailed result information
 * @param {Object} book - The book object to check
 * @param {Object} blacklist - The blacklist configuration
 * @returns {Object} Result object with isBlacklisted flag, reason, and matchedPattern
 */
function isBlacklisted(book, blacklist) {
    if (!book || !blacklist) {
        return { isBlacklisted: false, reason: null, matchedPattern: null };
    }

    try {
        // Check author blacklist
        if (Array.isArray(blacklist.authors)) {
            for (const author of blacklist.authors) {
                if (isAuthorMatch(book.author, author)) {
                    return {
                        isBlacklisted: true,
                        reason: "blacklisted_author",
                        matchedPattern: author
                    };
                }
            }
        }

        // Check title patterns (new format)
        if (Array.isArray(blacklist.title_patterns) && book.title) {
            const titleCheck = isTitleBlacklisted(book.title, blacklist.title_patterns);
            if (titleCheck.isBlacklisted) {
                return {
                    isBlacklisted: true,
                    reason: "blacklisted_title_pattern",
                    matchedPattern: titleCheck.matchedPattern
                };
            }
        }

        // Backward compatibility: Check old patterns format
        if (Array.isArray(blacklist.patterns)) {
            for (const pattern of blacklist.patterns) {
                // Handle old title: prefix format
                if (pattern.startsWith("title:") && book.title) {
                    const titlePattern = pattern.slice(6).trim();
                    const titleCheck = isTitleBlacklisted(book.title, [titlePattern]);
                    if (titleCheck.isBlacklisted) {
                        return {
                            isBlacklisted: true,
                            reason: "legacy_title_pattern",
                            matchedPattern: titlePattern
                        };
                    }
                }
                // Handle old author pattern format
                else if (isAuthorMatch(book.author, pattern)) {
                    return {
                        isBlacklisted: true,
                        reason: "legacy_author_pattern",
                        matchedPattern: pattern
                    };
                }
            }
        }

        return { isBlacklisted: false, reason: null, matchedPattern: null };
    } catch (error) {
        console.error('Error in isBlacklisted:', error);
        // In case of error, be conservative and return true to prevent potentially inappropriate content
        return {
            isBlacklisted: true,
            reason: "error_during_check",
            matchedPattern: error.message
        };
    }
}

/**
 * Main purge function that removes blacklisted books from the database
 * @returns {Object} Result object with success flag and statistics
 */
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

        // Process books
        console.log('\n📚 Checking books against blacklist...');
        const totalBooks = Object.keys(metadata.books).length;
        let checkedCount = 0;
        let purgedCount = 0;

        const purgedBooks = {};
        console.log(`\n🔍 Scanning ${totalBooks} books...`);
        
        // Create an array of promises for brownlist additions
        const brownlistPromises = [];
        
        for (const [asin, book] of Object.entries(metadata.books)) {
            checkedCount++;
            const blacklistResult = isBlacklisted(book, blacklist);

            if (blacklistResult.isBlacklisted) {
                purgedCount++;
                
                // Log detailed purge information
                logPurgeAction(book, blacklistResult.reason, blacklistResult.matchedPattern);
                
                // Add to purged books
                purgedBooks[asin] = book;
                
                // Add to brownlist (collect promise)
                brownlistPromises.push(
                    addToBrownlist(book, blacklistResult.reason, blacklistResult.matchedPattern)
                );
            } else if (checkedCount % 10 === 0 || checkedCount === totalBooks) {
                // Progress update every 10 books
                console.log(`✓ Checked ${checkedCount}/${totalBooks} books...`);
            }
        }

        // Wait for all brownlist additions to complete
        if (brownlistPromises.length > 0) {
            console.log(`\n📝 Adding ${brownlistPromises.length} books to brownlist...`);
            await Promise.all(brownlistPromises);
            console.log('✅ Brownlist updated successfully');
        }

        // Remove purged books from metadata
        if (purgedCount > 0) {
            console.log('\n🗑️ Removing purged books from database...');
            Object.keys(purgedBooks).forEach(asin => {
                delete metadata.books[asin];
            });
            console.log('✅ Purged books removed successfully');
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