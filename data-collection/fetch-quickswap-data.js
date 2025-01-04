const axios = require('axios');
const { logger } = require('../monitoring/logger');
const redis = require('redis');
require('dotenv').config();

const client = redis.createClient();

const QUICKSWAP_API = process.env.QUICKSWAP_API || 'https://gateway.thegraph.com/api/YOUR_API_KEY/subgraphs/id/FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g';

async function fetchQuickSwapData() {
  try {
    logger.info('Starting QuickSwap data fetcher...');
    logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);

    const query = `
      {
        pairs(first: 100, orderBy: volumeUSD, orderDirection: desc) {
          id
          token0 {
            id
            symbol
            name
          }
          token1 {
            id
            symbol
            name
          }
          volumeUSD
          reserveUSD
        }
      }
    `;

    const response = await axios.post(QUICKSWAP_API, { query });

    if (!response.data || !response.data.data || !response.data.data.pairs) {
      throw new Error('Invalid or null response from QuickSwap API.');
    }

    const pairs = response.data.data.pairs;
    logger.info(`Fetched ${pairs.length} QuickSwap pairs successfully.`);
    logger.debug(`Full QuickSwap pairs data: ${JSON.stringify(pairs)}`);

    // Store pairs in Redis
    await Promise.all(
      pairs.map(async (pair) => {
        const key = `quickswap:pair:${pair.id}`;
        await client.set(key, JSON.stringify(pair));
        logger.info(`Stored pair in Redis with key: ${key}`);
      })
    );

    logger.info('QuickSwap data fetcher completed successfully.');
  } catch (error) {
    logger.error('Error fetching QuickSwap data:', error.message);
    logger.error(`Detailed error: ${error.stack}`);
  } finally {
    client.quit();
  }
}

fetchQuickSwapData();
