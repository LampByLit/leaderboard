# Leaderboard Data Schema

This document outlines the structure of the JSON data files used by the Leaderboard application to store Amazon book information.

## Main Data File

The main data file (`books.json`) contains all the tracked books and their metadata. It follows this structure:

```json
{
  "metadata": {
    "lastUpdated": "2025-02-25T12:00:00.000Z",
    "version": "1.0",
    "bookCount": 10,
    "successCount": 9,
    "errorCount": 1
  },
  "books": [
    {
      "id": "ASIN1",
      "link": "https://www.amazon.com/dp/ASIN1",
      "title": "Book Title 1",
      "author": "Author Name 1",
      "bsr": 1234,
      "bsrHistory": [
        {
          "date": "2025-02-24T12:00:00.000Z",
          "rank": 1500
        },
        {
          "date": "2025-02-25T12:00:00.000Z",
          "rank": 1234
        }
      ],
      "lastUpdated": "2025-02-25T12:00:00.000Z",
      "lastSuccessful": "2025-02-25T12:00:00.000Z",
      "status": "success",
      "errorCount": 0,
      "errorMessage": null
    },
    {
      "id": "ASIN2",
      "link": "https://www.amazon.com/dp/ASIN2",
      "title": "Book Title 2",
      "author": "Author Name 2",
      "bsr": 5678,
      "bsrHistory": [
        {
          "date": "2025-02-24T12:00:00.000Z",
          "rank": 6000
        },
        {
          "date": "2025-02-25T12:00:00.000Z",
          "rank": 5678
        }
      ],
      "lastUpdated": "2025-02-25T12:00:00.000Z",
      "lastSuccessful": "2025-02-25T12:00:00.000Z",
      "status": "success",
      "errorCount": 0,
      "errorMessage": null
    }
  ]
}
```

## Fields Explanation

### Metadata Object

| Field | Type | Description |
|-------|------|-------------|
| `lastUpdated` | ISO Date String | Timestamp of the last update attempt |
| `version` | String | Schema version |
| `bookCount` | Number | Total number of books tracked |
| `successCount` | Number | Number of books successfully updated in last run |
| `errorCount` | Number | Number of books that failed to update in last run |

### Book Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Amazon ASIN (unique identifier) |
| `link` | String | Full Amazon URL to the book |
| `title` | String | Book title |
| `author` | String | Book author |
| `bsr` | Number | Current Best Seller Rank (lower is better) |
| `bsrHistory` | Array | Historical BSR data (limited to configurable length) |
| `lastUpdated` | ISO Date String | When this book entry was last updated |
| `lastSuccessful` | ISO Date String | When this book was last successfully scraped |
| `status` | String | Current status: "success", "error", or "pending" |
| `errorCount` | Number | Consecutive error count |
| `errorMessage` | String/null | Last error message if status is "error" |

### BSR History Object

| Field | Type | Description |
|-------|------|-------------|
| `date` | ISO Date String | Date of the historical record |
| `rank` | Number | BSR value at that date |

## Backup Files

Backup files follow the same structure but are named with a timestamp:
- `books-2025-02-25-120000.json`

## Import/Export Format

For importing/exporting a list of books to track, a simplified format is used:

```json
[
  {
    "link": "https://www.amazon.com/dp/ASIN1",
    "notes": "Optional notes about this book"
  },
  {
    "link": "https://www.amazon.com/dp/ASIN2",
    "notes": "Another book to track"
  }
]
```

## Data Storage Considerations

1. **File Location**
   - Data is stored in the configured `dataPath` directory
   - Default: `./src/data/`

2. **Backup Strategy**
   - Before each update, the current data file is backed up
   - Backups are rotated based on `backupCount` configuration
   - Oldest backups are automatically deleted

3. **Data Integrity**
   - Atomic writes are used to prevent data corruption
   - Data is first written to a temporary file, then renamed

4. **Error Recovery**
   - If a scraping operation fails, previous valid data is preserved
   - Individual book errors don't affect the entire dataset
