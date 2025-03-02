# Amazon Book Leaderboard 📚

A real-time book ranking system that tracks and displays Amazon Best Seller Ranks (BSR).

## Features 🚀

- Real-time BSR tracking and ranking
- Automated data scraping with stealth mode
- Multi-layer content filtering
- Live cycle status updates via SSE
- Responsive grid layout UI
- Automatic page refresh
- Detailed logging and error handling

## System Components 🔧

### Core Modules

- **Cycle Manager** (`cycle.js`)
  - Orchestrates the update process
  - Manages file operations
  - Handles error recovery

- **Scraper** (`scraper.js`)
  - Amazon-friendly data extraction
  - Rate limiting and stealth mode
  - User agent rotation

- **Purger** (`purger.js`)
  - Content filtering
  - Pattern matching
  - Blacklist management

- **Cleaner** (`cleaner.js`)
  - Data validation
  - Duplicate removal
  - Field normalization

- **Publisher** (`publisher.js`)
  - Data transformation
  - Atomic file operations
  - BSR-based ranking

### Server & UI

- **Express Server** (`server.js`)
  - SSE endpoint
  - Static file serving
  - Cycle management

- **Web Interface** (`index.html`)
  - Real-time updates
  - Responsive grid layout
  - Status monitoring

## Configuration 🛠️

### Required Files

- `config/blacklist.json`: Content filtering patterns
- `data/metadata.json`: Book data and state
- `data/books.json`: Published rankings

### Environment Variables

- `PORT`: Server port (default: 3000)
- `UPDATE_INTERVAL`: Cycle frequency in minutes
- `LOG_LEVEL`: Logging verbosity

## Development 💻

### Prerequisites

- Node.js 18+
- npm or yarn
- Git

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/hxkm/railwayleaderboard.git
   cd railwayleaderboard
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create configuration files:
   ```bash
   mkdir config data
   touch config/blacklist.json data/metadata.json
   ```

4. Start the server:
   ```bash
   npm start
   ```

### Testing

```bash
npm test
```

## Deployment 🚀

The application is deployed on Railway.app:
- URL: railwayleaderboard-production.up.railway.app
- Auto-deploys from main branch

## Contributing 🤝

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License 📄

MIT License - See LICENSE file for details.

## Acknowledgments 🙏

- Built with Express.js
- UI powered by Tailwind CSS
- Hosted on Railway.app
