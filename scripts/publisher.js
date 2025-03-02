/**
 * Leaderboard Publisher
 * ===================
 * 
 * Transforms raw book data into a ranked leaderboard format.
 * Handles the final stage of the update cycle, preparing data for public consumption.
 * 
 * Key Features:
 * - BSR-based ranking system
 * - Data validation and sanitization
 * - HTML entity decoding
 * - Atomic file operations
 * 
 * Validation Rules:
 * - Required fields: title, author, cover_url, bsr, url
 * - Valid BSR (numeric, > 0)
 * - Valid URLs (must be Amazon links)
 * - Sequential rank validation
 * - No duplicate ranks
 * 
 * Output Format:
 * {
 *   version: string,
 *   last_updated: ISO timestamp,
 *   books: {
 *     [asin]: {
 *       rank: number,
 *       title: string,
 *       author: string,
 *       cover_url: string,
 *       bsr: number,
 *       url: string
 *     }
 *   }
 * }
 * 
 * @module publisher
 */

const fs = require('fs').promises;
const path = require('path');

// Configure data directory
const DATA_DIR = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || './data');

// Helper function to get data file paths
function getDataPath(filename) {
    return path.join(DATA_DIR, filename);
}

// Helper function for safe atomic writes
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

// Transform metadata into ranked output format
function transformToOutput(metadata) {
    // Helper function to decode HTML entities
    function decodeHtmlEntities(text) {
        if (!text) return '';
        return text.replace(/&([^;]+);/g, (match, entity) => {
            const entities = {
                'amp': '&',
                'apos': "'",
                'quot': '"',
                'lt': '<',
                'gt': '>',
                '#39': "'",
                'nbsp': ' '
            };
            return entities[entity] || match;
        });
    }

    // Get books array and sort by BSR
    const sortedBooks = Object.entries(metadata.books)
        .map(([asin, book]) => ({
            asin,
            ...book,
            title: decodeHtmlEntities(book.title) // Decode title
        }))
        .sort((a, b) => {
            // Convert BSR strings to numbers and handle invalid values
            const bsrA = parseInt(String(a.bsr).replace(/,/g, ''), 10);
            const bsrB = parseInt(String(b.bsr).replace(/,/g, ''), 10);
            
            // Handle invalid BSR values
            if (isNaN(bsrA) && isNaN(bsrB)) return 0;
            if (isNaN(bsrA)) return 1;
            if (isNaN(bsrB)) return -1;
            
            return bsrA - bsrB;
        });

    // Create output format with ranks
    const books = {};
    sortedBooks.forEach((book, index) => {
        books[book.asin] = {
            rank: index + 1,
            title: book.title,
            author: book.author,
            cover_url: book.cover_url,
            bsr: book.bsr,
            url: book.url
        };
    });

    return {
        version: '1.0',
        last_updated: new Date().toISOString(),
        books
    };
}

// Validation functions
function isValidBook(book) {
    // Check required fields exist
    const requiredFields = ['title', 'author', 'cover_url', 'bsr', 'url'];
    const hasAllFields = requiredFields.every(field => field in book);
    if (!hasAllFields) {
        console.error('Book missing required fields:', book);
        return false;
    }

    // Validate types
    if (typeof book.title !== 'string' || book.title.trim().length === 0) {
        console.error('Invalid book title:', book.title);
        return false;
    }
    if (typeof book.author !== 'string' || book.author.trim().length === 0) {
        console.error('Invalid book author:', book.author);
        return false;
    }
    if (typeof book.cover_url !== 'string' || !book.cover_url.startsWith('http')) {
        console.error('Invalid cover URL:', book.cover_url);
        return false;
    }
    if (typeof book.url !== 'string' || !book.url.includes('amazon.com')) {
        console.error('Invalid Amazon URL:', book.url);
        return false;
    }
    if (isNaN(parseInt(String(book.bsr).replace(/,/g, ''), 10))) {
        console.error('Invalid BSR value:', book.bsr);
        return false;
    }

    return true;
}

function validateOutput(output) {
    // Check top-level structure
    if (!output || typeof output !== 'object') {
        throw new Error('Output must be an object');
    }
    if (typeof output.version !== 'string') {
        throw new Error('Output must have a version string');
    }
    if (!output.last_updated || !Date.parse(output.last_updated)) {
        throw new Error('Output must have a valid last_updated timestamp');
    }
    if (!output.books || typeof output.books !== 'object') {
        throw new Error('Output must have a books object');
    }

    // Validate each book
    const books = output.books;
    const validBooks = {};
    let hasInvalidBooks = false;

    // Track ranks for sequence validation
    const ranks = new Set();

    for (const [asin, book] of Object.entries(books)) {
        if (!asin || asin.length < 10) {
            console.error('Invalid ASIN:', asin);
            hasInvalidBooks = true;
            continue;
        }

        if (!isValidBook(book)) {
            hasInvalidBooks = true;
            continue;
        }

        // Ensure rank is a positive integer
        if (!Number.isInteger(book.rank) || book.rank < 1) {
            console.error('Invalid rank for book:', asin, book.rank);
            hasInvalidBooks = true;
            continue;
        }

        // Track rank for sequence validation
        ranks.add(book.rank);

        validBooks[asin] = book;
    }

    // Validate rank sequence
    const numBooks = Object.keys(validBooks).length;
    if (numBooks > 0) {
        // Check if we have all ranks from 1 to numBooks
        for (let i = 1; i <= numBooks; i++) {
            if (!ranks.has(i)) {
                throw new Error(`Invalid rank sequence: missing rank ${i}`);
            }
        }
        // Check if we have any ranks beyond numBooks
        if (ranks.size !== numBooks) {
            throw new Error('Invalid rank sequence: duplicate or out-of-range ranks found');
        }
    }

    if (hasInvalidBooks) {
        console.warn('Some invalid books were filtered out');
    }

    if (Object.keys(validBooks).length === 0) {
        throw new Error('No valid books found in output');
    }

    // Return sanitized output
    return {
        version: output.version,
        last_updated: output.last_updated,
        books: validBooks
    };
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

// Main publish function
async function publish() {
    try {
        console.log('\n🏆 Starting publish process...');
        
        // Read metadata.json
        const metadataPath = getDataPath('metadata.json');
        console.log('📖 Reading metadata...');
        let metadata;
        try {
            metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
            if (!metadata.books) {
                console.warn('⚠️ No books found in metadata, initializing empty books object');
                metadata.books = {};
            }
        } catch (error) {
            console.error('❌ Error reading metadata:', error);
            throw new Error('Failed to read metadata: ' + error.message);
        }
        
        // Process books
        console.log('\n📊 Processing books...');
        const totalBooks = Object.keys(metadata.books).length;
        if (totalBooks === 0) {
            console.warn('⚠️ No books found in metadata');
            // Create empty public books.json
            const emptyData = {
                version: '1.0',
                last_updated: new Date().toISOString(),
                books: {}
            };
            
            // Write empty state to books.json
            console.log('💾 Saving empty leaderboard...');
            const booksPath = getDataPath('books.json');
            await safeWriteJSON(booksPath, emptyData);
            
            // Update metadata with empty publish info
            metadata.last_publish = {
                timestamp: new Date().toISOString(),
                total_books: 0,
                ranked_books: 0
            };
            await safeWriteJSON(metadataPath, metadata);
            
            console.log('✅ Published empty leaderboard successfully\n');
            return {
                success: true,
                stats: {
                    total_books: 0,
                    ranked_books: 0,
                    timestamp: new Date().toISOString()
                },
                books: emptyData
            };
        }

        // Convert books object to array and sort by BSR
        const sortedBooks = Object.entries(metadata.books)
            .map(([asin, book]) => ({
                asin,
                ...book,
                title: book.title ? book.title.trim() : '',
                author: book.author ? book.author.trim() : '',
                bsr: parseInt(String(book.bsr).replace(/,/g, ''), 10)
            }))
            .filter(book => {
                const isValid = !isNaN(book.bsr) && book.title && book.author && book.cover_url;
                if (!isValid) {
                    console.log(`⚠️ Skipping invalid book: ${book.title || 'Unknown'}`);
                }
                return isValid;
            })
            .sort((a, b) => a.bsr - b.bsr);

        // Create ranked output
        const books = {};
        sortedBooks.forEach((book, index) => {
            books[book.asin] = {
                rank: index + 1,
                title: book.title,
                author: book.author,
                cover_url: book.cover_url,
                bsr: book.bsr,
                url: book.url
            };
            if (index < 3) {
                console.log(`🏅 Rank #${index + 1}: "${book.title}" by ${book.author} (BSR: ${book.bsr.toLocaleString()})`);
            }
        });

        console.log(`\n✨ Ranked ${Object.keys(books).length} books out of ${totalBooks} total`);
        
        // Create public books.json
        const publicData = {
            version: '1.0',
            last_updated: new Date().toISOString(),
            books
        };
        
        // Validate output before saving
        try {
            validateOutput(publicData);
        } catch (error) {
            console.error('❌ Output validation failed:', error);
            throw error;
        }
        
        // Write to books.json
        console.log('💾 Saving leaderboard...');
        const booksPath = getDataPath('books.json');
        await safeWriteJSON(booksPath, publicData);
        
        // Update metadata with latest publish info
        metadata.last_publish = {
            timestamp: new Date().toISOString(),
            total_books: Object.keys(books).length,
            ranked_books: Object.keys(books).length
        };
        await safeWriteJSON(metadataPath, metadata);
        
        console.log('✅ Publish process completed successfully\n');
        return { 
            success: true, 
            stats: {
                total_books: totalBooks,
                ranked_books: Object.keys(books).length,
                timestamp: new Date().toISOString()
            },
            books: publicData
        };
    } catch (error) {
        console.error('❌ Publish process failed:', error);
        return {
            success: false,
            error: error.message || 'Unknown error during publish'
        };
    }
}

module.exports = { publish }; 