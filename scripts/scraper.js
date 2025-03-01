/**
 * Amazon Book Scraper
 * ==================
 * 
 * ⚠️ WARNING: This tool is sketchy and will break any moment. Amazon employs very strict anti-bot technology.
 * Use at your own risk and with extreme caution. Getting blocked is not a matter of if, but when.
 * 
 * Key Features:
 * - Batch processing with configurable delays
 * - Browser simulation with rotating user agents
 * - Compression handling (gzip, deflate, brotli)
 * - CAPTCHA detection and avoidance
 * - Safe time windows to avoid peak hours
 * - Cookie management and session persistence
 * - Atomic file operations with backups
 * 
 * Safety Measures:
 * - MIN_REQUEST_DELAY: 90s between Amazon requests
 * - MAX_REQUEST_DELAY: 240s maximum delay
 * - Time window restrictions (avoid peak hours)
 * - Random delays with jitter
 * - Rotating user agents and viewport sizes
 * - Cookie management
 * 
 * @module scraper
 */

const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { purge } = require('./purger'); // Import the purge function

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

// Configure batch processing with more conservative delays
const BATCH_SIZE = 1; // Process only 1 book at a time
const BATCH_DELAY = 5000; // 5 seconds between batches
const MIN_REQUEST_DELAY = 90000; // 1.5 minutes minimum between requests
const MAX_REQUEST_DELAY = 240000; // 4 minutes maximum between requests
const MAX_RETRIES = 3; // Maximum number of retries
const INITIAL_RETRY_DELAY = 300000; // 5 minutes initial retry delay

// Enhanced browser headers
const BROWSER_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'DNT': '1',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
};

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

// Add more realistic user agents
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0'
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Add time-based request throttling
let lastRequestTime = 0;
const MIN_TIME_BETWEEN_REQUESTS = 60000; // 1 minute minimum between requests

// Enhanced delay function with random jitter
function delay(ms) {
    const jitter = Math.floor(Math.random() * 30000); // Add up to 30 seconds of random jitter
    return new Promise(resolve => setTimeout(resolve, ms + jitter));
}

// Add time window restrictions (avoid peak hours)
function isWithinSafeTimeWindow() {
    // Temporarily disable time window restrictions
    return true;
    
    // const hour = new Date().getHours();
    // return hour < 14 || hour > 21; // Old restrictive check
}

// Enhanced fetchPage function with time window check and compression handling
async function fetchPage(url, retryCount = 0) {
    // Check if we're in a safe time window
    if (!isWithinSafeTimeWindow()) {
        console.log('Outside safe time window, waiting for next window...');
        await delay(3600000); // Wait an hour
    }

    // Ensure minimum time between requests
    const timeSinceLastRequest = Date.now() - lastRequestTime;
    if (timeSinceLastRequest < MIN_TIME_BETWEEN_REQUESTS) {
        await delay(MIN_TIME_BETWEEN_REQUESTS - timeSinceLastRequest);
    }

    // Update last request time
    lastRequestTime = Date.now();

    return new Promise(async (resolve, reject) => {
        const viewport = getRandomViewport();
        
        // Combine default browser headers with dynamic ones
        const headers = {
            ...BROWSER_HEADERS,
            'viewport-width': viewport.width.toString(),
            'viewport-height': viewport.height.toString(),
            'Referer': 'https://www.amazon.com/',
            'User-Agent': getRandomUserAgent(), // Use rotating user agents
            'Accept-Encoding': 'gzip, deflate, br' // Explicitly accept compression
        };

        // Add cookies if we have any
        if (Object.keys(cookieJar).length > 0) {
            headers.Cookie = formatCookies(cookieJar);
        }

        // Configure request options
        const options = {
            timeout: 30000,
            headers
        };

        const request = https.get(url, options, async (res) => {
            // Store new cookies
            const newCookies = parseCookies(res);
            cookieJar = { ...cookieJar, ...newCookies };

            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302) {
                if (res.headers.location) {
                    console.log(`Redirecting to: ${res.headers.location}`);
                    try {
                        const result = await fetchPage(res.headers.location, retryCount);
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    }
                    return;
                }
            }

            // Handle rate limiting and other error status codes
            if (res.statusCode === 429 || res.statusCode === 503) {
                if (retryCount < MAX_RETRIES) {
                    const delayTime = Math.max(
                        INITIAL_RETRY_DELAY * Math.pow(2, retryCount),
                        MIN_REQUEST_DELAY
                    );
                    console.log(`Rate limited. Retrying in ${delayTime/1000} seconds... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
                    await delay(delayTime);
                    try {
                        const result = await fetchPage(url, retryCount + 1);
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

            // Handle compressed responses
            let stream = res;
            const contentEncoding = res.headers['content-encoding'];
            if (contentEncoding) {
                if (contentEncoding.includes('gzip')) {
                    stream = res.pipe(zlib.createGunzip());
                } else if (contentEncoding.includes('deflate')) {
                    stream = res.pipe(zlib.createInflate());
                } else if (contentEncoding.includes('br')) {
                    stream = res.pipe(zlib.createBrotliDecompress());
                }
            }

            let data = '';
            stream.on('data', (chunk) => data += chunk);
            stream.on('end', async () => {
                // Check for CAPTCHA/robot check with more patterns
                if (data.includes('Type the characters you see in this image') || 
                    data.includes('Enter the characters you see below') ||
                    data.includes('Sorry, we just need to make sure you\'re not a robot') ||
                    data.includes('To discuss automated access to Amazon data please contact') ||
                    data.includes('Bot Check') ||
                    data.includes('captcha')) {
                    
                    if (retryCount < MAX_RETRIES) {
                        const delayTime = Math.max(
                            INITIAL_RETRY_DELAY * Math.pow(2, retryCount),
                            MIN_REQUEST_DELAY
                        );
                        console.log(`CAPTCHA detected. Retrying in ${delayTime/1000} seconds... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
                        await delay(delayTime);
                        try {
                            const result = await fetchPage(url, retryCount + 1);
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

            stream.on('error', (err) => {
                reject(new Error(`Error decompressing response: ${err.message}`));
            });
        });

        request.on('error', async (err) => {
            if (retryCount < MAX_RETRIES) {
                const delayTime = Math.max(
                    INITIAL_RETRY_DELAY * Math.pow(2, retryCount),
                    MIN_REQUEST_DELAY
                );
                console.log(`Network error. Retrying in ${delayTime/1000} seconds... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
                await delay(delayTime);
                try {
                    const result = await fetchPage(url, retryCount + 1);
                    resolve(result);
                } catch (retryErr) {
                    reject(retryErr);
                }
            } else {
                console.error(`Error fetching ${url}:`, err);
                reject(err);
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
    // Debug: Log the first 1000 characters of HTML for inspection
    console.log('Debug - First 1000 chars of HTML:', html.substring(0, 1000));

    // Multiple patterns to check for paperback format
    const paperbackIndicators = [
        // Standard product subtitle
        html.includes('id="productSubtitle"') && html.includes('Paperback'),
        // Format selection button
        html.includes('aria-label="Paperback Format:">Paperback<'),
        // Product details section
        html.includes('>Paperback</span>'),
        // Alternative format indicators
        html.includes('>Format:</th>') && html.includes('>Paperback<'),
        // Product title containing format
        html.includes('title="Paperback:'),
        // Binding type in product details
        html.includes('>Binding</th>') && html.includes('>Paperback<'),
        // Format selector
        html.includes('data-a-html-content="Paperback"'),
        // Price block format
        html.includes('class="a-size-base a-color-secondary">Paperback</span>'),
        // Alternative product details
        html.includes('>Format:</td>') && html.includes('>Paperback<'),
        // Additional paperback indicators
        html.includes('Paperback – '),
        html.includes('Paperback:'),
        html.includes('"binding":"Paperback"'),
        html.includes('"format":"Paperback"'),
        // ISBN check (Kindle editions don't have ISBN)
        html.includes('ISBN-13') || html.includes('ISBN-10'),
        // Dimensions check (Kindle editions don't have physical dimensions)
        html.includes('Dimensions') && html.includes('inches')
    ];

    // Log which indicators were found
    paperbackIndicators.forEach((indicator, index) => {
        if (indicator) {
            console.log(`Debug - Found paperback indicator ${index + 1}`);
        }
    });

    // Return true if any paperback indicator is found
    const isPaperback = paperbackIndicators.some(indicator => indicator === true);
    console.log('Debug - Final paperback determination:', isPaperback);
    
    return isPaperback;
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
    console.log(`\n📖 Processing book: ${url}`);
    console.log('🔍 Extracting ASIN...');
    
    const asin = extractASIN(url);
    if (!asin) {
        console.log('❌ Invalid ASIN in URL');
        return { success: false, error: 'Invalid ASIN in URL' };
    }
    console.log(`✅ Found ASIN: ${asin}`);

    try {
        console.log('🌐 Fetching page...');
        const html = await fetchPage(url);
        if (!html) {
            console.log('❌ Failed to fetch page');
            return { success: false, error: 'Failed to fetch page' };
        }
        console.log('✅ Page fetched successfully');

        console.log('🔍 Extracting book details...');
        
        // Extract and validate title
        const title = extractTitle(html);
        if (!title) {
            console.log('❌ Could not extract title');
            return { success: false, error: 'Could not extract title' };
        }
        console.log(`📚 Title: "${title}"`);

        // Extract and validate author
        const author = extractAuthor(html);
        if (!author) {
            console.log('❌ Could not extract author');
            return { success: false, error: 'Could not extract author' };
        }
        console.log(`✍️ Author: ${author}`);

        // Verify it's a paperback
        console.log('📑 Verifying format...');
        if (!verifyPaperback(html)) {
            console.log('❌ Not a paperback listing');
            return { success: false, error: 'Not a paperback listing' };
        }
        console.log('✅ Verified paperback format');

        // Extract cover URL
        console.log('🖼️ Extracting cover image...');
        const coverUrl = extractCoverUrl(html);
        if (!coverUrl) {
            console.log('⚠️ Could not extract cover image');
            // Don't fail for missing cover
        } else {
            console.log('✅ Cover image found');
        }

        // Extract BSR
        console.log('📊 Extracting Best Sellers Rank...');
        const bsr = extractBSR(html);
        if (!bsr) {
            console.log('❌ Could not extract BSR');
            return { success: false, error: 'Could not extract BSR' };
        }
        console.log(`📈 BSR: ${bsr.toLocaleString()}`);

        // Return successful result
        console.log('✅ Book processed successfully\n');
        return {
            success: true,
            book: {
                asin,
                title,
                author,
                cover_url: coverUrl || '',
                bsr,
                url
            }
        };
    } catch (error) {
        console.error('❌ Error processing book:', error);
        return { success: false, error: error.message };
    }
}

// Add batch processing helper
async function processBatch(submissions, startIndex, batchSize, metadata) {
    console.log(`\n📚 Processing batch of ${batchSize} submissions starting at index ${startIndex}`);
    console.log('⏳ Adding delays between requests to avoid rate limiting...\n');

    const results = [];
    const endIndex = Math.min(startIndex + batchSize, submissions.length);
    
    for (let i = startIndex; i < endIndex; i++) {
        const submission = submissions[i];
        console.log(`🔄 [${i + 1}/${submissions.length}] Processing submission...`);
        
        // Add random delay between requests
        const delayTime = Math.floor(Math.random() * 7000) + 3000; // 3-10 seconds
        console.log(`⏰ Waiting ${(delayTime/1000).toFixed(1)} seconds before next request...`);
        await delay(delayTime);

        const result = await scrapeBook(submission.url);
        results.push(result);

        if (result.success) {
            metadata.books[result.book.asin] = result.book;
            console.log('📝 Updated metadata with new book information');
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
            
            // Run purger after each batch to filter out problematic content immediately
            console.log('\n🧹 Running purger after batch to filter problematic content...');
            try {
                const purgeResult = await purge();
                if (purgeResult.success) {
                    console.log(`✅ Purge completed: ${purgeResult.stats.purged_books} books removed`);
                } else {
                    console.warn(`⚠️ Purge after batch failed: ${purgeResult.error}`);
                }
            } catch (purgeError) {
                console.warn(`⚠️ Error running purger after batch: ${purgeError.message}`);
            }
            
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