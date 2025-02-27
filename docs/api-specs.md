# Leaderboard API Specifications

This document outlines the available API endpoints for the Leaderboard application.

## Base URL

All API endpoints are prefixed with `/api` by default (configurable in `config.js`).

## Available Endpoints

### Get All Books

Retrieves all tracked books sorted by BSR (Best Seller Rank).

- **URL**: `/api/books`
- **Method**: `GET`
- **URL Parameters**:
  - `sort` (optional): Field to sort by. Default: `bsr`
  - `order` (optional): Sort order, either `asc` or `desc`. Default: `asc` (lowest BSR first)
  - `limit` (optional): Maximum number of books to return. Default: all books
  - `page` (optional): Page number for pagination. Default: `1`

**Success Response**:
- **Code**: 200
- **Content**:
```json
{
  "metadata": {
    "lastUpdated": "2025-02-25T12:00:00.000Z",
    "count": 10,
    "total": 10,
    "page": 1
  },
  "books": [
    {
      "id": "ASIN1",
      "title": "Book Title 1",
      "author": "Author Name 1",
      "bsr": 1234,
      "link": "https://www.amazon.com/dp/ASIN1",
      "lastUpdated": "2025-02-25T12:00:00.000Z"
    },
    // More books...
  ]
}
```

**Error Response**:
- **Code**: 500
- **Content**:
```json
{
  "error": "Error message"
}
```

### Get Book Details

Retrieves detailed information about a specific book.

- **URL**: `/api/books/:id`
- **Method**: `GET`
- **URL Parameters**:
  - `id`: ASIN of the book

**Success Response**:
- **Code**: 200
- **Content**:
```json
{
  "id": "ASIN1",
  "title": "Book Title 1",
  "author": "Author Name 1",
  "bsr": 1234,
  "link": "https://www.amazon.com/dp/ASIN1",
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
  "status": "success"
}
```

**Error Response**:
- **Code**: 404
- **Content**:
```json
{
  "error": "Book not found"
}
```

### Get Status

Retrieves the current status of the leaderboard system.

- **URL**: `/api/status`
- **Method**: `GET`

**Success Response**:
- **Code**: 200
- **Content**:
```json
{
  "status": "ok",
  "lastUpdated": "2025-02-25T12:00:00.000Z",
  "nextScheduled": "2025-02-26T03:00:00.000Z",
  "bookCount": 10,
  "successCount": 9,
  "errorCount": 1,
  "isStale": false
}
```

### Trigger Refresh (Admin)

Manually triggers a refresh of the book data.

- **URL**: `/api/refresh`
- **Method**: `POST`
- **Headers**:
  - `Authorization`: Admin API key (configured in `config.js`)

**Success Response**:
- **Code**: 202
- **Content**:
```json
{
  "message": "Refresh job started",
  "jobId": "123456"
}
```

**Error Response**:
- **Code**: 401
- **Content**:
```json
{
  "error": "Unauthorized"
}
```

OR

- **Code**: 409
- **Content**:
```json
{
  "error": "A refresh job is already running",
  "jobId": "123456",
  "startedAt": "2025-02-25T12:00:00.000Z"
}
```

### Check Refresh Status (Admin)

Checks the status of a running refresh job.

- **URL**: `/api/refresh/:jobId`
- **Method**: `GET`
- **Headers**:
  - `Authorization`: Admin API key (configured in `config.js`)
- **URL Parameters**:
  - `jobId`: ID of the refresh job

**Success Response**:
- **Code**: 200
- **Content**:
```json
{
  "jobId": "123456",
  "status": "running",
  "progress": {
    "total": 10,
    "processed": 5,
    "successful": 4,
    "failed": 1
  },
  "startedAt": "2025-02-25T12:00:00.000Z",
  "estimatedCompletion": "2025-02-25T12:05:00.000Z"
}
```

**Error Response**:
- **Code**: 404
- **Content**:
```json
{
  "error": "Job not found"
}
```

## Frontend Integration

The frontend page will primarily use the `/api/books` endpoint to display the sorted list of books in the format "Title - Author".

A sample frontend fetch:

```javascript
fetch('/api/books?sort=bsr&order=asc')
  .then(response => response.json())
  .then(data => {
    const booksList = document.getElementById('books-list');
    
    data.books.forEach(book => {
      const bookItem = document.createElement('div');
      bookItem.className = 'book-item';
      bookItem.innerHTML = `
        <a href="${book.link}" target="_blank" rel="noopener noreferrer">
          ${book.title} - ${book.author}
        </a>
        <span class="bsr">#${book.bsr.toLocaleString()}</span>
      `;
      booksList.appendChild(bookItem);
    });
    
    // Update last refreshed time
    document.getElementById('last-updated').textContent = 
      new Date(data.metadata.lastUpdated).toLocaleString();
  })
  .catch(error => {
    console.error('Error fetching books:', error);
    document.getElementById('error-message').textContent = 
      'Failed to load books. Please try again later.';
  });
```

## Error Codes

The API may return the following HTTP status codes:

- `200 OK`: Request succeeded
- `202 Accepted`: Request was accepted (for async operations)
- `400 Bad Request`: Invalid request parameters
- `401 Unauthorized`: Authentication required
- `403 Forbidden`: Authenticated but not authorized
- `404 Not Found`: Resource not found
- `409 Conflict`: Request conflicts with current state
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error
- `503 Service Unavailable`: Service temporarily unavailable
