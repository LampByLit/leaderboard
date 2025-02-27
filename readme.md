# Amazon Book Rankings Leaderboard

A web application that tracks and displays Amazon book rankings in real-time. Built with Node.js, Express, and modern web technologies.

## Features

- Real-time tracking of Amazon book Best Seller Rankings (BSR)
- Automated web scraping with anti-detection measures
- Beautiful, responsive UI with dark theme
- URL submission system with rate limiting
- Automatic blacklist filtering
- JSON data visualization
- Cover image preview system
- Cooldown-based update system

## Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Data Storage**: JSON-based file system
- **Web Scraping**: Puppeteer with stealth plugin
- **UI Components**: Custom CSS with Material Design influence
- **Security**: Rate limiting, input validation, URL sanitization

## Project Structure

```
├── scripts/
│   ├── cleaner.js      # Submission cleanup logic
│   ├── cycle.js        # Full update cycle orchestration
│   ├── publisher.js    # Leaderboard publishing logic
│   ├── purger.js      # Blacklist filtering
│   ├── scraper.js     # Amazon scraping logic
│   └── utils/         # Utility functions
├── public/
│   └── index.html     # Main frontend interface
├── server.js          # Express server and API endpoints
├── input.json         # URL submissions storage
├── books.json         # Processed book data
├── metadata.json      # System metadata and state
└── blacklist.json     # Filtered content rules
```

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/amazon-book-rankings.git
   cd amazon-book-rankings
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   node server.js
   ```

4. Access the application at `http://localhost:3000`

## API Endpoints

- `POST /submit-url`: Submit a new Amazon book URL
- `POST /update-leaderboard`: Trigger leaderboard update
- `POST /purge`: Run blacklist filtering
- `POST /cleanup`: Clean old submissions
- `POST /publish`: Update public leaderboard
- `POST /cycle`: Run full update cycle

## Features in Detail

### URL Submission
- Validates Amazon book URLs
- Enforces URL length limits (max 150 characters)
- Rate limiting per IP address
- Daily submission limits

### Scraping System
- Respects Amazon's robots.txt
- Implements random delays
- Uses rotating user agents
- Handles CAPTCHAs and blocks
- Exponential backoff for retries

### Data Management
- Atomic file operations
- Backup system for data safety
- JSON validation
- Duplicate detection
- Error logging

### Security Features
- Input sanitization
- Rate limiting
- IP tracking
- Error handling
- Safe file operations

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built with love for the /lit/ community
- Thanks to all contributors and users

## Important Notes

- This is a tool for tracking legitimate book rankings
- Please respect Amazon's terms of service
- Use responsibly and ethically
- Not for commercial use
