import { CronJob } from 'cron';

// Update the cron schedule to run once per day at midnight
const job = new CronJob('0 0 * * *', async () => {
  console.log('Running daily scrape job...');
  try {
    await scrapeBooks();
  } catch (error) {
    console.error('Error in cron job:', error);
  }
}); 