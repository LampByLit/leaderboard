# Amazon Book Rankings Leaderboard

A Node.js application that tracks Amazon book rankings and displays them in a leaderboard format.

## Features

- Scrapes Amazon book Best Seller Ranks (BSR)
- Displays books sorted by BSR
- Automatic data cleanup and maintenance
- Rate-limited and Amazon-friendly scraping
- Persistent data storage using Railway Volumes

## Deployment on Railway

### Prerequisites

1. Install Railway CLI:
```bash
npm i -g @railway/cli
```

2. Login to Railway:
```bash
railway login
```

### Setup

1. Create a new Railway project:
```bash
railway init
```

2. Create a volume for data storage:
```bash
railway volume create book-data
```

3. Link your project:
```bash
railway link
```

4. Set up environment variables:
```bash
railway variables set RAILWAY_VOLUME_MOUNT_PATH=/data
```

### Deploy

1. Deploy your application:
```bash
railway up
```

2. Monitor your deployment:
```bash
railway logs
```

## Local Development

1. Clone the repository:
```bash
git clone https://github.com/hxkm/amazon-book-ranker.git
cd amazon-book-ranker
```

2. Install dependencies:
```bash
npm install
```

3. Create a local data directory:
```bash
mkdir data
```

4. Start the server:
```bash
node server.js
```

The server will be available at `http://localhost:3000`.

## Project Structure

```
├── scripts/
│   ├── cleaner.js      # Cleans up old submissions
│   ├── cycle.js        # Orchestrates the update cycle
│   ├── init-volume.js  # Initializes data volume
│   ├── publisher.js    # Publishes leaderboard data
│   ├── purger.js       # Removes blacklisted entries
│   └── scraper.js      # Scrapes Amazon data
├── server.js           # Main server file
├── index.html          # Frontend interface
├── railway.toml        # Railway configuration
└── package.json        # Project dependencies
```

## Data Files

All data files are stored in the mounted volume at `/data`:

- `input.json`: Submitted Amazon URLs
- `books.json`: Published leaderboard data
- `metadata.json`: Internal metadata and state
- `blacklist.json`: Filtering patterns

## Environment Variables

- `RAILWAY_VOLUME_MOUNT_PATH`: Path to the mounted volume (default: `/data`)
- `PORT`: Server port (set by Railway)

## License

MIT License - see LICENSE file for details.
