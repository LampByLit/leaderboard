/**
 * Leaderboard Configuration Template
 * 
 * Copy this file to config.js and customize the settings
 */

module.exports = {
  /**
   * Array of Amazon book URLs to track
   * These should be direct links to the book product pages
   */
  amazonLinks: [
    'https://www.amazon.com/dp/ASIN1',
    'https://www.amazon.com/dp/ASIN2',
    // Add more Amazon book links here
  ],

  /**
   * Scraping settings to ensure Amazon-friendly behavior
   */
  scrapingSettings: {
    // Base delay between requests in milliseconds (5000 = 5 seconds)
    delay: 5000,
    
    // Random factor for delay variation (0.5 = ±50%)
    // Actual delay will be between delay*(1-randomFactor) and delay*(1+randomFactor)
    randomFactor: 0.5,
    
    // Maximum retries per book when encountering errors
    maxRetries: 3,
    
    // Exponential backoff factor for retries
    backoffFactor: 2,
    
    // Timeout for page operations in milliseconds
    timeout: 30000,
    
    // User agents to rotate between requests
    userAgents: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36'
    ],
    
    // Request headers
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': 'https://www.google.com/',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0'
    }
  },

  /**
   * Schedule settings for automated scraping
   */
  scheduleSettings: {
    // Cron schedule expression (default: once per day at 3:00 AM)
    // Format: second minute hour day-of-month month day-of-week
    // Use https://crontab.guru/ to generate expressions
    cronSchedule: '0 0 3 * * *',
    
    // Timezone for the cron schedule
    timeZone: 'America/New_York',
    
    // Whether to run a scrape immediately on startup
    runOnStartup: true,
    
    // Maximum runtime for a single scraping session (in minutes)
    // Session will gracefully terminate after this time
    maxRuntime: 30
  },

  /**
   * Data storage settings
   */
  dataSettings: {
    // Directory to store JSON data (relative to project root)
    dataPath: './src/data',
    
    // Main data file name
    dataFile: 'books.json',
    
    // Number of historical backups to maintain
    backupCount: 5,
    
    // Maximum age of data before considering it stale (in hours)
    // Used for frontend to display warning if data is too old
    maxDataAge: 48
  },

  /**
   * Server settings
   */
  serverSettings: {
    // Port for the web server
    port: process.env.PORT || 3000,
    
    // Enable CORS (if needed)
    enableCors: true,
    
    // Static files directory
    staticDir: './src/public',
    
    // Enable request logging
    enableRequestLogging: true
  },

  /**
   * Logging settings
   */
  loggingSettings: {
    // Log level (error, warn, info, verbose, debug, silly)
    level: 'info',
    
    // Enable console logging
    console: true,
    
    // File logging
    file: {
      enabled: true,
      filename: './logs/leaderboard-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d'
    }
  }
};
