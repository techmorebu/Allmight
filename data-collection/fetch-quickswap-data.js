const axios = require('axios');
const { logger } = require('../monitoring/logger');
const redis = require('redis');
require('dotenv').config();

const client = redis.createClient();

const QUICKSWAP_API = process.env.QUICKSWAP_API;

async function fetchQuickSwapData() {
  logger.info('Starting QuickSwap data fetcher...');

  try {
    logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);
    const response = await axios.post(QUICKSWAP_API, {
      query: `
        query {
          pairs(first: 10) {
            id
            token0 { id symbol }
            token1 { id symbol }
            reserveUSD
          }
        }
      `,
    });

    // Log the full API response for debugging
    logger.info('Full API response:', JSON.stringify(response.data, null, 2));

    if (!response.data || !response.data.data || !response.data.data.pairs) {
      throw new Error('Invalid or null response from QuickSwap API.');
    }

    const pairs = response.data.data.pairs;
    logger.info(`Fetched ${pairs.length} pairs from QuickSwap.`);

    // Store pairs in Redis
    for (const pair of pairs) {
      const key = `quickswap:pair:${pair.id}`;
      await client.set(key, JSON.stringify(pair));
      logger.info(`Stored pair ${pair.id} in Redis.`);
    }

    logger.info('QuickSwap data fetching completed successfully.');
  } catch (error) {
    logger.error('Error fetching QuickSwap data:', error.message);
    logger.error('Detailed error:', error);
  } finally {
    client.quit();
  }
}

fetchQuickSwapData();
