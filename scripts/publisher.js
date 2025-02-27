const fs = require('fs').promises;
const path = require('path');

// Helper function for safe atomic writes
async function safeWriteJSON(filePath, data) {
    const backupPath = `${filePath}.backup`;
    const tempPath = `${filePath}.temp`;
    
    try {
        // Create backup of current file if it exists
        try {
            const currentData = await fs.readFile(filePath, 'utf8');
            await fs.writeFile(backupPath, currentData);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }

        // Write new data to temp file first
        await fs.writeFile(tempPath, JSON.stringify(data, null, 4));
        
        // Rename temp file to actual file (atomic operation)
        await fs.rename(tempPath, filePath);
        
        // Remove backup after successful write
        try {
            await fs.unlink(backupPath);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.warn('Warning: Could not remove backup file:', err);
            }
        }
    } catch (error) {
        // If anything went wrong, try to restore from backup
        console.error('Error during safe write:', error);
        
        try {
            if (await fs.access(backupPath).then(() => true).catch(() => false)) {
                await fs.copyFile(backupPath, filePath);
                console.log('Restored from backup');
            }
        } catch (restoreError) {
            console.error('Critical error: Could not restore from backup:', restoreError);
            throw restoreError;
        }
        
        throw error;
    } finally {
        // Cleanup temp file if it exists
        try {
            await fs.unlink(tempPath);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.warn('Warning: Could not remove temp file:', err);
            }
        }
    }
}

// Transform metadata into ranked output format
function transformToOutput(metadata) {
    // Get books array and sort by BSR
    const sortedBooks = Object.entries(metadata.books)
        .map(([asin, book]) => ({
            asin,
            ...book
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

// Main publish function
async function publish() {
    console.log('Starting publish operation...');
    
    try {
        // File paths
        const metadataPath = path.join(__dirname, '..', 'metadata.json');
        const booksPath = path.join(__dirname, '..', 'books.json');  // Changed to books.json

        // Load metadata
        let metadata;
        try {
            const data = await fs.readFile(metadataPath, 'utf8');
            metadata = JSON.parse(data);
            console.log(`Loaded metadata with ${Object.keys(metadata.books).length} books`);
        } catch (error) {
            console.error('Error loading metadata:', error);
            return { success: false, error: 'Failed to load metadata' };
        }

        // Transform metadata to output format
        let output = transformToOutput(metadata);
        console.log(`Transformed ${Object.keys(output.books).length} books with rankings`);

        // Validate output before writing
        try {
            output = validateOutput(output);
            console.log('Output validation successful');
        } catch (error) {
            console.error('Output validation failed:', error);
            return { success: false, error: `Validation failed: ${error.message}` };
        }

        // Write output file
        try {
            await safeWriteJSON(booksPath, output);
            console.log('Successfully wrote books.json');
        } catch (error) {
            console.error('Error writing output:', error);
            return { success: false, error: 'Failed to write output file' };
        }
        
        return { 
            success: true, 
            stats: {
                total_books: Object.keys(output.books).length,
                timestamp: output.last_updated
            }
        };
    } catch (error) {
        console.error('Publish error:', error);
        return { success: false, error: error.message };
    }
}

module.exports = { publish }; 