require('dotenv').config();
const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const QUICKSWAP_API = 'https://api.thegraph.com/subgraphs/name/sameepsi/quickswap';
const redis = new Redis();

async function fetchQuickSwapData() {
  logger.info('Starting QuickSwap data fetcher...');

  try {
    // GraphQL query for pairs
    const query = `
      {
        pairs(first: 10, orderBy: reserveUSD, orderDirection: desc) {
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
          reserveUSD
          volumeUSD
        }
      }
    `;

    const response = await axios.post(QUICKSWAP_API, { query });
    const pairs = response.data.data.pairs;

    if (!pairs || pairs.length === 0) {
      logger.warn('No data received from QuickSwap API.');
      return;
    }

    // Store pairs in Redis
    for (const pair of pairs) {
      const key = `quickswap:pair:${pair.id}`;
      await redis.set(key, JSON.stringify(pair));
      logger.info(`Stored data for pair: ${pair.id}`);
    }

    logger.info('QuickSwap data fetcher completed successfully.');
  } catch (error) {
    logger.error(`Error fetching QuickSwap data: ${error.message}`);
  } finally {
    redis.quit();
  }
}

fetchQuickSwapData();
