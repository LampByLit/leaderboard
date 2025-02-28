const fs = require('fs').promises;
const path = require('path');
const https = require('https');

// Configure data directory
const DATA_DIR = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || './data');

// Store cookies between requests
let cookieJar = {};

// Helper function to parse cookies from response
function parseCookies(response) {
    const cookies = {};
    const cookieHeaders = response.headers['set-cookie'] || [];
    cookieHeaders.forEach(cookie => {
        const [keyValue] = cookie.split(';');
        const [key, value] = keyValue.split('=');
        cookies[key.trim()] = value;
    });
    return cookies;
}

// Helper function to format cookies for request
function formatCookies(cookies) {
    return Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
}

// Configure batch processing
const BATCH_SIZE = 1; // Process 1 book at a time for gentler scraping
const BATCH_DELAY = 12000; // 12 seconds between batches
const MIN_REQUEST_DELAY = 8000; // Minimum 8 seconds between requests
const MAX_REQUEST_DELAY = 15000; // Maximum 15 seconds between requests

// Helper function to get data file paths
function getDataPath(filename) {
    return path.join(DATA_DIR, filename);
}

// Add viewport dimensions for more realistic browser simulation
const VIEWPORT_WIDTHS = [1366, 1440, 1536, 1920, 2560];
const VIEWPORT_HEIGHTS = [768, 900, 864, 1080, 1440];

function getRandomViewport() {
    const width = VIEWPORT_WIDTHS[Math.floor(Math.random() * VIEWPORT_WIDTHS.length)];
    const height = VIEWPORT_HEIGHTS[Math.floor(Math.random() * VIEWPORT_HEIGHTS.length)];
    return { width, height };
}

// Add rotating user agents
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 OPR/107.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Vivaldi/6.5.3206.53'
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Add delay helper with exponential backoff
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Enhanced fetchPage with retry logic and cookie handling
async function fetchPage(url, retryCount = 0, maxRetries = 5) {
    const baseDelay = 5000; // 5 seconds base delay
    const viewport = getRandomViewport();
    
    return new Promise((resolve, reject) => {
        const headers = {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
            'viewport-width': viewport.width.toString(),
            'viewport-height': viewport.height.toString(),
            'DNT': '1'
        };

        // Add cookies if we have any
        if (Object.keys(cookieJar).length > 0) {
            headers.Cookie = formatCookies(cookieJar);
        }

        const request = https.get(url, { timeout: 15000, headers }, async (res) => {
            // Store new cookies
            const newCookies = parseCookies(res);
            cookieJar = { ...cookieJar, ...newCookies };

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

        // Extract other metadata
        const title = extractTitle(html);
        const author = extractAuthor(html);
        const cover_url = extractCoverUrl(html);

        // Validate required fields
        if (!title || !author || !cover_url) {
            return {
                success: false,
                error: 'missing_metadata',
                message: 'Missing required metadata'
            };
        }

        // Only proceed if we have all required fields
        return {
            success: true,
            data: {
                url,
                asin,
                title,
                author,
                cover_url,
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

// Add batch processing helper
async function processBatch(submissions, startIndex, batchSize, metadata) {
    const results = [];
    const batch = submissions.slice(startIndex, startIndex + batchSize);
    
    console.log(`\n=== Processing batch ${Math.floor(startIndex/batchSize) + 1} ===`);
    console.log(`Books ${startIndex + 1}-${Math.min(startIndex + batchSize, submissions.length)} of ${submissions.length}`);
    
    for (let i = 0; i < batch.length; i++) {
        const submission = batch[i];
        try {
            const currentBook = startIndex + i + 1;
            const progressBar = '='.repeat(Math.floor((currentBook/submissions.length) * 20)) + 
                              '-'.repeat(20 - Math.floor((currentBook/submissions.length) * 20));
            
            console.log(`\n[${progressBar}] ${currentBook}/${submissions.length}`);
            console.log(`🔍 Scraping: ${submission.url}`);
            
            const result = await scrapeBook(submission.url);
            if (result && result.success) {
                metadata.books[result.data.asin] = {
                    ...result.data,
                    last_updated: new Date().toISOString()
                };
                console.log(`✅ Success! BSR: ${result.data.bsr.toLocaleString()}`);
                console.log(`📖 "${result.data.title}" by ${result.data.author}`);
                results.push(result);
            } else {
                console.log(`❌ Failed: ${result.error}`);
            }
            
            // Update progress
            metadata.scraping_progress.current = startIndex + i + 1;
            await safeWriteJSON(getDataPath('metadata.json'), metadata);
            
            // Random delay between requests within a batch (2-4 seconds)
            if (i < batch.length - 1) {
                const delay = Math.random() * (MAX_REQUEST_DELAY - MIN_REQUEST_DELAY) + MIN_REQUEST_DELAY;
                console.log(`⏳ Waiting ${(delay/1000).toFixed(1)}s before next book...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        } catch (error) {
            console.error(`❌ Error scraping ${submission.url}:`, error);
        }
    }
    
    return results;
}

// Main scrape function
async function scrape(progressCallback = () => {}) {
    console.log('\n🚀 Starting scrape process...\n');
    
    try {
        // Read input.json
        const inputPath = getDataPath('input.json');
        const inputData = JSON.parse(await fs.readFile(inputPath, 'utf8'));
        
        // Read metadata.json
        const metadataPath = getDataPath('metadata.json');
        let metadata;
        try {
            metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        } catch (error) {
            if (error.code === 'ENOENT') {
                metadata = { books: {}, last_update: new Date().toISOString() };
            } else {
                throw error;
            }
        }
        
        // Initialize scraping progress
        metadata.scraping_progress = {
            current: 0,
            total: inputData.submissions.length,
            successful: 0
        };
        await safeWriteJSON(metadataPath, metadata);
        
        // Send initial progress
        progressCallback({
            current: 0,
            total: inputData.submissions.length,
            successful: 0
        });
        
        console.log(`📚 Found ${inputData.submissions.length} books to scrape`);
        console.log(`🔄 Processing in batches of ${BATCH_SIZE} with ${BATCH_DELAY/1000}s delay between batches\n`);
        
        // Process submissions in batches
        const results = [];
        let successfulScrapes = 0;
        
        for (let i = 0; i < inputData.submissions.length; i += BATCH_SIZE) {
            const batchResults = await processBatch(inputData.submissions, i, BATCH_SIZE, metadata);
            results.push(...batchResults);
            
            // Update successful scrapes count and send progress
            successfulScrapes = results.filter(r => r.success).length;
            progressCallback({
                current: Math.min(i + BATCH_SIZE, inputData.submissions.length),
                total: inputData.submissions.length,
                successful: successfulScrapes
            });
            
            // Add delay between batches if not the last batch
            if (i + BATCH_SIZE < inputData.submissions.length) {
                const nextBatch = Math.min(i + BATCH_SIZE + BATCH_SIZE, inputData.submissions.length);
                console.log(`\n⏳ Waiting ${BATCH_DELAY/1000}s before processing next batch (${i + BATCH_SIZE + 1}-${nextBatch})...\n`);
                await delay(BATCH_DELAY);
            }
        }
        
        // Clear scraping progress and update metadata
        delete metadata.scraping_progress;
        metadata.last_update = new Date().toISOString();
        await safeWriteJSON(metadataPath, metadata);
        
        console.log('\n✨ Scrape process completed successfully');
        console.log(`📊 Final Results: ${successfulScrapes}/${inputData.submissions.length} books scraped successfully\n`);
        
        return {
            success: true,
            stats: {
                processed_urls: inputData.submissions.length,
                successful_scrapes: successfulScrapes,
                updated_books: Object.keys(metadata.books).length,
                timestamp: new Date().toISOString()
            }
        };
    } catch (error) {
        console.error('\n❌ Scrape process failed:', error);
        return {
            success: false,
            error: error.message || 'Unknown error during scrape'
        };
    }
}

module.exports = { scrape }; 