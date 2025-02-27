const fs = require('fs').promises;
const path = require('path');

// Utility function to normalize author names for comparison
function normalizeAuthorName(author) {
    if (!author) return '';
    return author
        .toLowerCase()                         // Convert to lowercase
        .normalize('NFD')                      // Normalize unicode characters
        .replace(/[\u0300-\u036f]/g, '')      // Remove diacritics
        .replace(/[^\w\s\.-]/g, ' ')          // Convert special chars to spaces, keep dots for initials
        .replace(/\s+/g, ' ')                 // Normalize whitespace
        .replace(/\.\s*/g, '')                // Remove dots from initials
        .trim();                              // Remove leading/trailing whitespace
}

// Debug utility to test name normalization
async function testNormalization(author) {
    const normalized = normalizeAuthorName(author);
    console.log(`Original: "${author}" → Normalized: "${normalized}"`);
    return normalized;
}

// Logging utility
async function logPurgedEntry(book) {
    const logPath = path.join(__dirname, '..', 'purge_log.json');
    try {
        // Read existing log
        let log;
        try {
            log = JSON.parse(await fs.readFile(logPath, 'utf8'));
        } catch (error) {
            log = { purged_entries: [] };
        }

        // Add new entry with timestamp
        log.purged_entries.push({
            timestamp: new Date().toISOString(),
            asin: book.asin,
            title: book.title,
            author: book.author,
            reason: 'blacklisted_author'
        });

        // Save log
        await fs.writeFile(logPath, JSON.stringify(log, null, 4));
    } catch (error) {
        console.error('Error logging purged entry:', error);
        // Don't throw - we don't want logging failures to affect the purge
    }
}

// Main purge function - removes books by blacklisted authors
async function purge() {
    try {
        // Load blacklist
        const blacklistPath = path.join(__dirname, '..', 'blacklist.json');
        const metadataPath = path.join(__dirname, '..', 'metadata.json');
        const backupPath = `${metadataPath}.backup`;

        // Load and validate blacklist
        let blacklist;
        try {
            blacklist = JSON.parse(await fs.readFile(blacklistPath, 'utf8'));
            if (!Array.isArray(blacklist.authors)) {
                throw new Error('Invalid blacklist format: expected authors array');
            }
            if (blacklist.authors.some(author => !author || typeof author !== 'string')) {
                throw new Error('Invalid blacklist: contains null, undefined, or non-string authors');
            }
            console.log(`Loaded blacklist with ${blacklist.authors.length} authors`);
        } catch (error) {
            console.error('Error loading blacklist:', error);
            return { success: false, error: 'Failed to load blacklist' };
        }

        // Create Set of normalized blacklisted authors
        const blacklistedAuthors = new Set(
            blacklist.authors
                .filter(author => author && author.trim()) // Extra safety: remove empty strings
                .map(author => normalizeAuthorName(author))
        );
        console.log(`Normalized ${blacklistedAuthors.size} unique author names`);

        // Load metadata
        let metadata;
        try {
            // Create backup first
            const currentMetadata = await fs.readFile(metadataPath, 'utf8');
            await fs.writeFile(backupPath, currentMetadata);
            
            metadata = JSON.parse(currentMetadata);
            console.log(`Loaded metadata with ${Object.keys(metadata.books).length} books`);
        } catch (error) {
            console.error('Error loading metadata:', error);
            return { success: false, error: 'Failed to load metadata' };
        }

        // Track statistics
        const stats = {
            total_checked: 0,
            purged: 0,
            errors: 0
        };

        // Filter out blacklisted authors
        const originalBookCount = Object.keys(metadata.books).length;
        const purgedBooks = [];

        for (const [asin, book] of Object.entries(metadata.books)) {
            stats.total_checked++;
            
            // Skip books with missing author information
            if (!book.author) {
                console.warn(`Book ${book.title} (${asin}) has no author information`);
                stats.errors++;
                continue;
            }

            const normalizedAuthor = normalizeAuthorName(book.author);
            
            if (blacklistedAuthors.has(normalizedAuthor)) {
                console.log(`Purging book: "${book.title}" by "${book.author}" (normalized: "${normalizedAuthor}")`);
                // Log before removing
                await logPurgedEntry(book);
                purgedBooks.push(book);
                delete metadata.books[asin];
                stats.purged++;
            }
        }

        // Update metadata stats
        metadata.stats.total_books = Object.keys(metadata.books).length;
        metadata.stats.active_books = Object.values(metadata.books)
            .filter(book => book.status === 'active').length;
        metadata.stats.last_purge = {
            timestamp: new Date().toISOString(),
            books_checked: stats.total_checked,
            books_purged: stats.purged,
            errors: stats.errors
        };

        console.log(`Purge complete: ${stats.purged} books removed, ${stats.errors} errors`);

        // Save updated metadata
        try {
            await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 4));
            // Remove backup after successful write
            await fs.unlink(backupPath);
            console.log('Successfully saved updated metadata');
        } catch (error) {
            console.error('Error saving metadata:', error);
            // Try to restore from backup
            try {
                const backup = await fs.readFile(backupPath, 'utf8');
                await fs.writeFile(metadataPath, backup);
                return { 
                    success: false, 
                    error: 'Failed to save changes, restored from backup' 
                };
            } catch (restoreError) {
                console.error('Critical error: Could not restore from backup:', restoreError);
                return { 
                    success: false, 
                    error: 'Failed to save changes and restore from backup' 
                };
            }
        }

        return { 
            success: true, 
            stats,
            purged_books: purgedBooks
        };
    } catch (error) {
        console.error('Purge error:', error);
        return { success: false, error: error.message };
    }
}

module.exports = { purge, testNormalization }; 