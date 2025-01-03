require('dotenv').config();
const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

// QuickSwap API from .env
const QUICKSWAP_API = process.env.QUICKSWAP_API || 'https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g';
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

    logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);
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
