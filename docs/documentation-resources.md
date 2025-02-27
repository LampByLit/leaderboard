# Framework Documentation Resources

This document provides links to official documentation and useful resources for all libraries and frameworks used in the Leaderboard project.

## Core Technologies

### Node.js
- [Official Documentation](https://nodejs.org/en/docs/)
- [Node.js API Reference](https://nodejs.org/api/)
- [File System Module](https://nodejs.org/api/fs.html) - For JSON file operations
- [Events Module](https://nodejs.org/api/events.html) - For custom event handling

### Express
- [Official Documentation](https://expressjs.com/)
- [API Reference](https://expressjs.com/en/4x/api.html)
- [Static File Serving](https://expressjs.com/en/starter/static-files.html)
- [Error Handling](https://expressjs.com/en/guide/error-handling.html)

## Web Scraping

### Puppeteer
- [Official Documentation](https://pptr.dev/)
- [API Reference](https://pptr.dev/api)
- [Examples](https://github.com/puppeteer/puppeteer/tree/main/examples)
- [Troubleshooting](https://pptr.dev/troubleshooting)

### Puppeteer-Extra & Stealth Plugin
- [puppeteer-extra GitHub](https://github.com/berstend/puppeteer-extra)
- [puppeteer-extra-plugin-stealth GitHub](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)
- [Stealth Techniques Documentation](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth#readme)

### Cheerio (Alternative HTML Parsing)
- [Official Documentation](https://cheerio.js.org/)
- [GitHub Repository](https://github.com/cheeriojs/cheerio)
- [API Reference](https://cheerio.js.org/docs/api/introduction)

## Scheduling & Tasks

### Node-Cron
- [GitHub Repository](https://github.com/node-cron/node-cron)
- [Cron Expression Guide](https://crontab.guru/)
- [Examples](https://github.com/node-cron/node-cron#examples)

### Async Utilities
- [Async.js](https://caolan.github.io/async/v3/) - For managing concurrent scraping operations
- [API Reference](https://caolan.github.io/async/v3/docs.html)

## Logging & Monitoring

### Winston
- [GitHub Repository](https://github.com/winstonjs/winston)
- [API Documentation](https://github.com/winstonjs/winston#api-docs)
- [Configuration Guide](https://github.com/winstonjs/winston#creating-your-own-logger)

### Morgan (HTTP request logging)
- [GitHub Repository](https://github.com/expressjs/morgan)
- [Format Tokens](https://github.com/expressjs/morgan#tokens)

## Testing

### Jest
- [Official Documentation](https://jestjs.io/docs/getting-started)
- [API Reference](https://jestjs.io/docs/api)
- [Expect Methods](https://jestjs.io/docs/expect)
- [Puppeteer with Jest](https://jestjs.io/docs/puppeteer)

## Security & Best Practices

### CORS
- [cors npm package](https://github.com/expressjs/cors)
- [Configuration Options](https://github.com/expressjs/cors#configuration-options)

### Helmet (Security Headers)
- [GitHub Repository](https://github.com/helmetjs/helmet)
- [Documentation](https://helmetjs.github.io/)

## Utilities

### Lodash
- [Official Documentation](https://lodash.com/docs/)
- [Array Methods](https://lodash.com/docs/#array)
- [Collection Methods](https://lodash.com/docs/#collection)

### Moment.js (Date Handling)
- [Official Documentation](https://momentjs.com/docs/)
- [Format Tokens](https://momentjs.com/docs/#/displaying/format/)
- [Date Manipulation](https://momentjs.com/docs/#/manipulating/)

## Specific Amazon Scraping Resources

### Web Scraping Best Practices
- [Robots.txt Protocol](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
- [Respectful Web Scraping Guide](https://www.scrapehero.com/how-to-prevent-getting-blacklisted-while-scraping/)

### Amazon HTML Structure
- [Scraping Amazon Product Details Guide](https://www.scrapehero.com/how-to-scrape-amazon-product-details-using-python/)
- [Amazon Product Data Fields](https://webservices.amazon.com/paapi5/documentation/get-items.html#iteminfo)

## Deployment

### PM2 (Process Manager)
- [Official Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Process Management](https://pm2.keymetrics.io/docs/usage/process-management/)
- [Startup Script](https://pm2.keymetrics.io/docs/usage/startup/)

### Docker
- [Official Documentation](https://docs.docker.com/)
- [Dockerfile Reference](https://docs.docker.com/engine/reference/builder/)
- [Docker Compose](https://docs.docker.com/compose/)

## Frontend Resources

### Vanilla JavaScript DOM Manipulation
- [MDN DOM Introduction](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Introduction)
- [Element Methods](https://developer.mozilla.org/en-US/docs/Web/API/Element)

## Tutorials and Examples

### Puppeteer Scraping Tutorials
- [Scraping with Puppeteer](https://www.digitalocean.com/community/tutorials/how-to-scrape-a-website-using-node-js-and-puppeteer)
- [Handling JavaScript Rendered Content](https://blog.logrocket.com/how-to-scrape-websites-node-js-puppeteer/)

### JSON File Handling
- [Reading and Writing JSON Files in Node.js](https://stackabuse.com/reading-and-writing-json-files-with-node-js/)
- [Atomic File Operations](https://nodejs.org/api/fs.html#fs_fs_rename_oldpath_newpath_callback)
