const fs = require('fs').promises;
const path = require('path');
const https = require('https');

// Add rotating user agents
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Edg/91.0.864.59'
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Add delay helper with exponential backoff
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Enhanced fetchPage with retry logic
async function fetchPage(url, retryCount = 0, maxRetries = 3) {
    const baseDelay = 3000; // 3 seconds base delay
    
    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': getRandomUserAgent(),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'max-age=0'
            }
        }, async (res) => {
            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302) {
                if (res.headers.location) {
                    console.log(`Redirecting to: ${res.headers.location}`);
                    try {
                        const result = await fetchPage(res.headers.location, retryCount, maxRetries);
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    }
                    return;
                }
            }

            // Handle rate limiting and other error status codes
            if (res.statusCode === 429 || res.statusCode === 503) {
                if (retryCount < maxRetries) {
                    const delayTime = Math.pow(2, retryCount) * baseDelay;
                    console.log(`Rate limited. Retrying in ${delayTime/1000} seconds...`);
                    await delay(delayTime);
                    try {
                        const result = await fetchPage(url, retryCount + 1, maxRetries);
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    }
                    return;
                }
            }

            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP status code ${res.statusCode}`));
            }

            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', async () => {
                // Check for CAPTCHA/robot check
                if (data.includes('Type the characters you see in this image') || 
                    data.includes('Enter the characters you see below') ||
                    data.includes('Sorry, we just need to make sure you\'re not a robot')) {
                    
                    if (retryCount < maxRetries) {
                        const delayTime = Math.pow(2, retryCount) * baseDelay;
                        console.log(`CAPTCHA detected. Retrying in ${delayTime/1000} seconds...`);
                        await delay(delayTime);
                        try {
                            const result = await fetchPage(url, retryCount + 1, maxRetries);
                            resolve(result);
                        } catch (err) {
                            reject(err);
                        }
                        return;
                    }
                    return reject(new Error('CAPTCHA detected after max retries'));
                }
                resolve(data);
            });
        });

        request.on('error', async (err) => {
            if (retryCount < maxRetries) {
                const delayTime = Math.pow(2, retryCount) * baseDelay;
                console.log(`Network error. Retrying in ${delayTime/1000} seconds...`);
                await delay(delayTime);
                try {
                    const result = await fetchPage(url, retryCount + 1, maxRetries);
                    resolve(result);
                } catch (retryErr) {
                    reject(retryErr);
                }
            } else {
                console.error(`Error fetching ${url}:`, err);
                reject(err);
            }
        });

        request.on('timeout', async () => {
            request.destroy();
            if (retryCount < maxRetries) {
                const delayTime = Math.pow(2, retryCount) * baseDelay;
                console.log(`Request timed out. Retrying in ${delayTime/1000} seconds...`);
                await delay(delayTime);
                try {
                    const result = await fetchPage(url, retryCount + 1, maxRetries);
                    resolve(result);
                } catch (retryErr) {
                    reject(retryErr);
                }
            } else {
                reject(new Error('Request timed out after max retries'));
            }
        });
    });
}

// Helper function to extract ASIN from Amazon URL
function extractASIN(url) {
    const match = url.match(/\/dp\/([A-Z0-9]{10})/);
    return match ? match[1] : null;
}

// Helper functions to extract metadata
function extractTitle(html) {
    const match = html.match(/<span id="productTitle"[^>]*>([^<]+)<\/span>/);
    if (!match) return null;
    
    // Clean up the title - remove anything in parentheses/brackets and after colons/semicolons
    let title = match[1].trim();
    title = title.replace(/\s*[\(\[].+?[\)\]]\s*/g, ''); // Remove bracketed content
    title = title.split(/[;:]/, 1)[0].trim(); // Take only part before semicolon/colon
    return title;
}

function extractAuthor(html) {
    // Try multiple patterns for author extraction
    const patterns = [
        // Pattern 1: Standard author link with (Author) text
        /<a[^>]*>([^<]+)<\/a>[^<]*<span[^>]*>\s*\(Author\)/,
        // Pattern 2: Author in contributor section
        /<div class="contribution">[^<]*<span class="a-color-secondary">[^<]*<\/span>[^<]*<a[^>]*>([^<]+)<\/a>/,
        // Pattern 3: Author in byline
        /<span class="author[^"]*">[^<]*<a[^>]*>([^<]+)<\/a>/,
        // Pattern 4: Author in product details
        /<span class="author notFaded"[^>]*>(?:[^<]*<span[^>]*>)*[^<]*<a[^>]*>([^<]+)<\/a>/,
        // Pattern 5: Author in book details
        /<tr class="author">[^<]*<td[^>]*>[^<]*<a[^>]*>([^<]+)<\/a>/,
        // Pattern 6: Author in title
        /<span id="productTitle"[^>]*>[^<]*?by\s+([^<]+?)\s*</i,
        // Pattern 7: Author in meta tags
        /<meta name="author" content="([^"]+)"/
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            // Clean up author name
            let author = match[1].trim()
                .replace(/\s+/g, ' ')           // Normalize whitespace
                .replace(/^by\s+/i, '')         // Remove leading "by"
                .replace(/\s*\([^)]*\)/g, '')   // Remove parenthetical text
                .trim();
            
            if (author) return author;
        }
    }

    // Try finding author in structured data
    try {
        const structuredDataMatch = html.match(/<script type="application\/ld\+json">[^<]*({[^<]+})[^<]*<\/script>/);
        if (structuredDataMatch) {
            const data = JSON.parse(structuredDataMatch[1]);
            if (data.author && data.author.name) {
                return data.author.name;
            }
        }
    } catch (error) {
        console.error('Error parsing structured data:', error);
    }

    return null;
}

function verifyPaperback(html) {
    // Check both methods of paperback verification
    const subtitleCheck = html.includes('id="productSubtitle"') && html.includes('Paperback');
    const formatCheck = html.includes('aria-label="Paperback Format:">Paperback<');
    return subtitleCheck || formatCheck;
}

function extractCoverUrl(html) {
    const match = html.match(/id="landingImage"[^>]*data-a-dynamic-image="([^"]+)"/);
    if (!match) return null;

    try {
        // Parse the JSON-like string containing image URLs
        const imageData = JSON.parse(match[1].replace(/&quot;/g, '"'));
        
        // Find URL with highest resolution by comparing dimensions
        let maxResolution = 0;
        let bestUrl = null;
        
        for (const [url, dimensions] of Object.entries(imageData)) {
            const resolution = dimensions[0] * dimensions[1];
            if (resolution > maxResolution) {
                maxResolution = resolution;
                bestUrl = url;
            }
        }
        
        return bestUrl;
    } catch (error) {
        console.error('Error parsing cover URL:', error);
        return null;
    }
}

function extractBSR(html) {
    if (!html) {
        console.warn('Empty HTML provided to extractBSR');
        return null;
    }

    try {
        // Multiple patterns to match BSR in different page layouts
        const patterns = [
            /#([0-9,]+)[^#]*?in Books/,                           // Standard format
            /Best Sellers Rank:\s*#([0-9,]+)[^#]*?in Books/,      // Alternative format
            /Books\s*\(See Top 100[^#]*#([0-9,]+)/,              // Another variation
            /Clasificación en los más vendidos[^#]*#([0-9,]+)/    // International format
        ];
        
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) {
                const bsr = parseInt(match[1].replace(/,/g, ''));
                if (!isNaN(bsr) && bsr > 0) {
                    // Log successful extraction with pattern used
                    console.log(`BSR extracted: ${bsr.toLocaleString()} (using pattern: ${pattern})`);
                    return bsr;
                }
            }
        }

        // If no patterns matched, log the failure
        console.warn('No valid BSR pattern found in HTML');
        return null;
    } catch (error) {
        console.error('Error extracting BSR:', error);
        return null;
    }
}

// Helper function for safe file writing
async function safeWriteJSON(filePath, data) {
    const backupPath = `${filePath}.backup`;
    try {
        // Create backup of current file if it exists
        try {
            const currentData = await fs.readFile(filePath, 'utf8');
            await fs.writeFile(backupPath, currentData);
        } catch (err) {
            // If file doesn't exist yet, that's fine
            if (err.code !== 'ENOENT') throw err;
        }

        // Write new data
        await fs.writeFile(filePath, JSON.stringify(data, null, 4));
        
        // Remove backup after successful write
        try {
            await fs.unlink(backupPath);
        } catch (err) {
            // Ignore if backup doesn't exist
            if (err.code !== 'ENOENT') console.warn('Warning: Could not remove backup file');
        }
    } catch (error) {
        // If writing failed and we have a backup, restore from backup
        try {
            const backup = await fs.readFile(backupPath, 'utf8');
            await fs.writeFile(filePath, backup);
            console.error('Error writing file, restored from backup:', error);
            throw new Error('Failed to write file, restored from backup');
        } catch (restoreError) {
            console.error('Critical error: Could not restore from backup:', restoreError);
            throw restoreError;
        }
    }
}

// Main scraping function
async function scrapeBook(url) {
    try {
        const html = await fetchPage(url);
        
        // Extract ASIN first
        const asin = extractASIN(url);
        if (!asin) {
            return {
                success: false,
                error: 'invalid_asin',
                message: 'Invalid or missing ASIN'
            };
        }

        // Verify it's a paperback
        if (!verifyPaperback(html)) {
            return {
                success: false,
                error: 'not_paperback',
                message: 'Not a paperback'
            };
        }

        // Extract BSR
        const bsr = extractBSR(html);
        if (!bsr) {
            return {
                success: false,
                error: 'missing_bsr',
                message: 'Missing Best Sellers Rank'
            };
        }

        // Only proceed if we have all required fields
        return {
            success: true,
            data: {
                url,
                asin,
                title: extractTitle(html),
                author: extractAuthor(html),
                cover_url: extractCoverUrl(html),
                bsr,
                last_checked: new Date().toISOString(),
                status: 'active'
            }
        };
    } catch (error) {
        console.error(`Error scraping ${url}:`, error.message);
        return {
            success: false,
            error: 'network_error',
            message: error.message
        };
    }
}

// Main scrape function
async function scrape() {
    try {
        const startTime = Date.now();
        
        // Read input.json
        const inputPath = path.join(__dirname, '..', 'input.json');
        const metadataPath = path.join(__dirname, '..', 'metadata.json');
        
        let inputData;
        try {
            inputData = await fs.readFile(inputPath, 'utf8');
        } catch (error) {
            console.error('Error reading input.json:', error);
            return { success: false, error: 'Failed to read input file' };
        }

        let submissions;
        try {
            submissions = JSON.parse(inputData).submissions;
        } catch (error) {
            console.error('Error parsing input.json:', error);
            return { success: false, error: 'Invalid input file format' };
        }

        // Read current metadata
        let metadata;
        try {
            const metadataData = await fs.readFile(metadataPath, 'utf8');
            metadata = JSON.parse(metadataData);
        } catch (error) {
            console.error('Error reading/parsing metadata.json:', error);
            metadata = { books: {}, stats: {} };
        }

        console.log(`Starting scrape of ${submissions.length} URLs...`);
        
        let successCount = 0;
        let failureCount = 0;
        let currentBook = 0;
        const totalBooks = submissions.length;
        
        // Track permanently failed submissions
        const permanentlyFailed = new Set();
        
        // Add delay between requests to be nice to Amazon
        for (const submission of submissions) {
            try {
                currentBook++;
                console.log(`Progress: ${currentBook} of ${totalBooks} books - Scraping ${submission.url}...`);
                
                // Update progress in metadata
                metadata.scraping_progress = {
                    current: currentBook,
                    total: totalBooks,
                    current_url: submission.url,
                    last_updated: new Date().toISOString()
                };
                
                try {
                    await safeWriteJSON(metadataPath, metadata);
                } catch (error) {
                    console.error('Error updating progress in metadata:', error);
                }
                
                const result = await scrapeBook(submission.url);
                
                if (result.success && result.data.asin && result.data.bsr) {
                    const { asin } = result.data;
                    console.log(`Successfully scraped ${result.data.title} by ${result.data.author || 'Unknown Author'} (BSR: ${result.data.bsr.toLocaleString()})`);
                    successCount++;
                    
                    // Update or create book entry
                    if (!metadata.books[asin]) {
                        metadata.books[asin] = {
                            ...result.data,
                            first_seen: new Date().toISOString(),
                            leaderboard_rank: 0,
                            history: []
                        };
                    } else {
                        metadata.books[asin] = {
                            ...metadata.books[asin],
                            ...result.data,
                            history: [
                                ...metadata.books[asin].history,
                                {
                                    timestamp: new Date().toISOString(),
                                    bsr: result.data.bsr
                                }
                            ]
                        };
                    }
                } else {
                    console.log(`Failed to scrape ${submission.url} - ${result.message}`);
                    failureCount++;
                    
                    if (result.error === 'invalid_asin' || 
                        result.error === 'not_paperback' || 
                        result.error === 'missing_bsr') {
                        permanentlyFailed.add(submission.url);
                    }
                }

                try {
                    await safeWriteJSON(metadataPath, metadata);
                } catch (error) {
                    console.error('Error updating metadata after book:', error);
                }

            } catch (error) {
                console.error(`Error processing submission ${submission.url}:`, error);
                failureCount++;
            }

            // Be nice to Amazon - wait 3 seconds between requests
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Clean up input.json by removing permanently failed submissions
        if (permanentlyFailed.size > 0) {
            try {
                console.log(`Removing ${permanentlyFailed.size} invalid submissions from input.json...`);
                const cleanedSubmissions = submissions.filter(sub => !permanentlyFailed.has(sub.url));
                await safeWriteJSON(inputPath, { submissions: cleanedSubmissions });
                console.log('Successfully removed invalid submissions from input.json');
            } catch (error) {
                console.error('Error cleaning up input.json:', error);
                // Don't throw - just log the error and continue
            }
        }

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(1);

        // Clear progress and update metadata stats
        delete metadata.scraping_progress;
        metadata.last_updated = new Date().toISOString();
        metadata.stats = {
            total_books: Object.keys(metadata.books).length,
            active_books: Object.values(metadata.books).filter(book => book.status === 'active').length,
            last_scrape_duration: `${duration}s`,
            scrape_success_rate: `${Math.round((successCount / submissions.length) * 100)}%`,
            last_scrape_results: {
                attempted: submissions.length,
                succeeded: successCount,
                failed: failureCount,
                permanently_failed: permanentlyFailed.size
            }
        };
        
        try {
            await safeWriteJSON(metadataPath, metadata);
        } catch (error) {
            console.error('Error saving final metadata:', error);
            // Don't throw - just log the error and continue
        }
        
        console.log(`Scraping completed in ${duration} seconds`);
        console.log(`Results: ${successCount} succeeded, ${failureCount} failed (${permanentlyFailed.size} permanent failures)`);
        return { success: true };
    } catch (error) {
        console.error('Scraper error:', error);
        return { success: false, error: error.message };
    }
}

module.exports = { scrape }; 