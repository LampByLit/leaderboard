import fs from 'fs/promises';

export async function scrapeBooks() {
  try {
    // Update the path to read from root directory
    const inputData = JSON.parse(await fs.readFile('./input.json', 'utf-8'));
    
    // ... rest of existing code ...
  } catch (error) {
    console.error('Error in scrapeBooks:', error);
    throw error;
  }
} 