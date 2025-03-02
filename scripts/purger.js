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

// Debug function to check file existence and contents
async function debugFile(filePath) {
    try {
        await fs.access(filePath);
        console.log(`✅ DEBUG: File exists at ${filePath}`);
        try {
            const content = await fs.readFile(filePath, 'utf8');
            console.log(`✅ DEBUG: File size: ${content.length} bytes`);
            if (content.length < 1000) {
                console.log(`📄 DEBUG: File content: ${content}`);
            } else {
                console.log(`📄 DEBUG: File content preview: ${content.substring(0, 200)}...`);
            }
            
            try {
                const parsed = JSON.parse(content);
                console.log(`✅ DEBUG: Valid JSON with keys: ${Object.keys(parsed).join(', ')}`);
                if (parsed.authors) {
                    console.log(`✅ DEBUG: Found ${parsed.authors.length} authors in blacklist`);
                    parsed.authors.forEach(author => console.log(`👤 DEBUG: Blacklisted author: ${author}`));
                }
                if (parsed.title_patterns) {
                    console.log(`✅ DEBUG: Found ${parsed.title_patterns.length} title patterns in blacklist`);
                    parsed.title_patterns.forEach(pattern => console.log(`📕 DEBUG: Blacklisted title pattern: ${pattern}`));
                }
            } catch (jsonError) {
                console.error(`❌ DEBUG: Invalid JSON: ${jsonError.message}`);
            }
        } catch (readErr) {
            console.error(`❌ DEBUG: Cannot read file: ${readErr.message}`);
        }
    } catch (accessErr) {
        console.error(`❌ DEBUG: File does not exist: ${accessErr.message}`);
    }
}

/**
 * Initializes the brownlist.json file if it doesn't exist or is empty/invalid
 * Creates with default structure for tracking rejected books
 * @returns {Promise<void>}
 */
async function initializeBrownlist() {
    const brownlistPath = getDataPath('brownlist.json');
    
    try {
        // Check if file exists
        try {
            await fs.access(brownlistPath);
            console.log('✓ Brownlist file exists');
            
            // Check if file is empty or has invalid JSON
            try {
                const data = await fs.readFile(brownlistPath, 'utf8');
                
                // If file is empty, initialize it
                if (!data || data.trim() === '') {
                    throw new Error('Empty brownlist file');
                }
                
                // Try to parse the JSON
                const brownlist = JSON.parse(data);
                
                // Validate structure
                if (!brownlist || typeof brownlist !== 'object') {
                    throw new Error('Invalid brownlist structure');
                }
                
                // Ensure required fields exist
                if (!Array.isArray(brownlist.rejected_books)) {
                    console.log('⚠️ Brownlist missing rejected_books array, repairing...');
                    brownlist.rejected_books = [];
                    await safeWriteJSON(brownlistPath, brownlist);
                    console.log('✅ Repaired brownlist.json structure');
                }
            } catch (parseErr) {
                console.log(`⚠️ Brownlist issue: ${parseErr.message}`);
                await createNewBrownlist(brownlistPath);
            }
        } catch (accessErr) {
            if (accessErr.code === 'ENOENT') {
                await createNewBrownlist(brownlistPath);
            } else {
                throw accessErr;
            }
        }
    } catch (error) {
        console.error(`❌ Failed to initialize brownlist: ${error.message}`);
        // Don't throw - we'll continue without brownlist
        console.log('⚠️ Continuing without brownlist...');
    }
}

/**
 * Creates a new brownlist file with default structure
 * @param {string} filePath - Path to brownlist file
 * @returns {Promise<void>}
 */
async function createNewBrownlist(filePath) {
    const initialBrownlist = {
        version: "1.0.0",
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        rejected_books: []
    };
    
    await fs.writeFile(filePath, JSON.stringify(initialBrownlist, null, 4));
    console.log('✅ Initialized new brownlist.json');
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
        // Try to read existing brownlist file
        try {
            const brownlistData = await fs.readFile(brownlistPath, 'utf8');
            
            // Handle empty file case
            if (!brownlistData || brownlistData.trim() === '') {
                throw new Error('Empty brownlist file');
            }
            
            brownlist = JSON.parse(brownlistData);
            
            // Validate the structure
            if (!brownlist || typeof brownlist !== 'object') {
                throw new Error('Invalid brownlist format');
            }
            
            // Ensure rejected_books array exists
            if (!Array.isArray(brownlist.rejected_books)) {
                console.log('⚠️ Brownlist missing rejected_books array, initializing...');
                brownlist.rejected_books = [];
            }
        } catch (err) {
            // Initialize new brownlist if file doesn't exist, is empty, or has invalid JSON
            console.log(`⚠️ Brownlist issue: ${err.message}, creating new brownlist structure`);
            brownlist = {
                version: "1.0.0",
                created_at: new Date().toISOString(),
                last_updated: new Date().toISOString(),
                rejected_books: []
            };
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
        return true;
    } catch (error) {
        console.error(`❌ Error adding to brownlist: ${error.message}`);
        // Try to create a new brownlist file as a last resort
        try {
            console.log('🔄 Attempting to create new brownlist file...');
            const newBrownlist = {
                version: "1.0.0",
                created_at: new Date().toISOString(),
                last_updated: new Date().toISOString(),
                rejected_books: [{
                    asin: book.asin,
                    title: book.title,
                    author: book.author,
                    url: book.url,
                    bsr: book.bsr,
                    rejection_reason: reason,
                    matched_pattern: matchedPattern,
                    timestamp: new Date().toISOString()
                }]
            };
            await fs.writeFile(brownlistPath, JSON.stringify(newBrownlist, null, 4));
            console.log('✅ Created new brownlist file with the rejected book');
            return true;
        } catch (fallbackError) {
            console.error(`❌ Failed to create brownlist file: ${fallbackError.message}`);
            return false;
        }
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
        
        // Initialize brownlist if it doesn't exist
        await initializeBrownlist();
        
        // Read metadata.json
        const metadataPath = getDataPath('metadata.json');
        console.log('📖 Reading metadata...');
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        
        // Read blacklist.json - with enhanced error handling
        const blacklistPath = getDataPath('blacklist.json');
        console.log(`🔍 Looking for blacklist at: ${blacklistPath}`);
        
        // Debug the blacklist file
        await debugFile(blacklistPath);
        
        let blacklist;
        try {
            console.log('📋 Loading blacklist configuration...');
            const blacklistData = await fs.readFile(blacklistPath, 'utf8');
            console.log(`📄 Blacklist data size: ${blacklistData.length} bytes`);
            
            if (!blacklistData || blacklistData.trim() === '') {
                console.error('❌ Empty blacklist file');
                throw new Error('Empty blacklist file');
            }
            
            try {
                blacklist = JSON.parse(blacklistData);
                
                // Ensure required arrays exist
                if (!blacklist.authors) {
                    console.log('⚠️ No authors array in blacklist, initializing...');
                    blacklist.authors = [];
                }
                
                if (!blacklist.title_patterns) {
                    console.log('⚠️ No title_patterns array in blacklist, initializing...');
                    blacklist.title_patterns = [];
                }
                
                if (!blacklist.patterns) {
                    console.log('⚠️ No patterns array in blacklist, initializing...');
                    blacklist.patterns = [];
                }
                
                // Explicitly populate with critical values if empty
                if (blacklist.authors.length === 0) {
                    console.log('⚠️ Empty authors array, adding critical values');
                    blacklist.authors.push('Adolf Hitler', 'William Shakespeare', 'Randall Kennedy', 'Rick Donahue', 'Dick Gregory');
                }
                
                if (blacklist.title_patterns.length === 0) {
                    console.log('⚠️ Empty title_patterns array, adding critical values');
                    blacklist.title_patterns.push('nigger', 'mein kampf', 'adult', 'xxx', 'erotica');
                }
                
                // Log blacklist configuration
                console.log(`\n📊 Blacklist Status:
    - ${blacklist.authors?.length || 0} authors blacklisted
    - ${blacklist.title_patterns?.length || 0} title patterns
    - ${blacklist.patterns?.length || 0} legacy patterns
    - Version: ${blacklist.version || 'N/A'}
    - Last Updated: ${blacklist.last_updated ? new Date(blacklist.last_updated).toLocaleString() : 'N/A'}`);
                
                // List some entries for debugging
                if (blacklist.authors && blacklist.authors.length > 0) {
                    console.log(`\n👤 Sample blacklisted authors: ${blacklist.authors.slice(0, 3).join(', ')}${blacklist.authors.length > 3 ? '...' : ''}`);
                }
                
                if (blacklist.title_patterns && blacklist.title_patterns.length > 0) {
                    console.log(`\n📕 Sample blacklisted title patterns: ${blacklist.title_patterns.slice(0, 3).join(', ')}${blacklist.title_patterns.length > 3 ? '...' : ''}`);
                }
                
            } catch (parseError) {
                console.error(`❌ Error parsing blacklist JSON: ${parseError.message}`);
                // Create a hardcoded emergency blacklist
                console.log('🚨 Creating emergency hardcoded blacklist');
                blacklist = { 
                    authors: ['Adolf Hitler', 'William Shakespeare', 'Randall Kennedy', 'Rick Donahue', 'Dick Gregory'],
                    title_patterns: ['nigger', 'mein kampf', 'adult', 'xxx', 'erotica'],
                    patterns: [],
                    version: "emergency",
                    last_updated: new Date().toISOString()
                };
            }
        } catch (error) {
            console.error(`❌ Error reading blacklist: ${error.message}`);
            // Create a hardcoded emergency blacklist
            console.log('🚨 Creating emergency hardcoded blacklist');
            blacklist = { 
                authors: ['Adolf Hitler', 'William Shakespeare', 'Randall Kennedy', 'Rick Donahue', 'Dick Gregory'],
                title_patterns: ['nigger', 'mein kampf', 'adult', 'xxx', 'erotica'],
                patterns: [],
                version: "emergency",
                last_updated: new Date().toISOString()
            };
        }

        // Process books
        console.log('\n📚 Checking books against blacklist...');
        const totalBooks = Object.keys(metadata.books).length;
        let checkedCount = 0;
        let purgedCount = 0;

        const purgedBooks = {};
        console.log(`\n🔍 Scanning ${totalBooks} books...`);
        
        // Create an array for tracking brownlist additions
        const brownlistFailures = [];
        
        for (const [asin, book] of Object.entries(metadata.books)) {
            checkedCount++;
            const blacklistResult = isBlacklisted(book, blacklist);

            if (blacklistResult.isBlacklisted) {
                purgedCount++;
                
                // Log detailed purge information
                logPurgeAction(book, blacklistResult.reason, blacklistResult.matchedPattern);
                
                // Add to purged books
                purgedBooks[asin] = book;
                
                // Try to add to brownlist but don't wait for it
                try {
                    const success = await addToBrownlist(book, blacklistResult.reason, blacklistResult.matchedPattern);
                    if (!success) {
                        brownlistFailures.push(book.title);
                    }
                } catch (brownlistError) {
                    console.error(`❌ Error adding "${book.title}" to brownlist: ${brownlistError.message}`);
                    brownlistFailures.push(book.title);
                }
            } else if (checkedCount % 10 === 0 || checkedCount === totalBooks) {
                // Progress update every 10 books
                console.log(`✓ Checked ${checkedCount}/${totalBooks} books...`);
            }
        }

        // Log brownlist status
        if (purgedCount > 0) {
            if (brownlistFailures.length === 0) {
                console.log('✅ All purged books successfully added to brownlist');
            } else {
                console.warn(`⚠️ Failed to add ${brownlistFailures.length} books to brownlist`);
            }
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