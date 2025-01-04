const axios = require('axios');
const { logger } = require('../monitoring/logger');
const { redisClient } = require('../database/redis');
require('dotenv').config();

const QUICKSWAP_API = process.env.QUICKSWAP_API || 'https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g';

const QUERY = `
{
  pairs(first: 100, orderBy: reserveUSD, orderDirection: desc) {
    id
    token0 {
      id
      symbol
    }
    token1 {
      id
      symbol
    }
    reserveUSD
    volumeUSD
  }
}`;

async function fetchQuickSwapData() {
  logger.info('Starting QuickSwap data fetcher...');
  logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);

  try {
    const response = await axios.post(QUICKSWAP_API, { query: QUERY });
    
    if (!response.data || !response.data.data || !response.data.data.pairs) {
      throw new Error('Invalid or null response from QuickSwap API.');
    }

    const pairs = response.data.data.pairs;
    logger.info(`Fetched ${pairs.length} pairs from QuickSwap.`);

    // Storing each pair in Redis
    pairs.forEach(async (pair) => {
      const key = `quickswap:pair:${pair.id}`;
      await redisClient.set(key, JSON.stringify(pair));
      logger.info(`Stored pair ${pair.id} in Redis.`);
    });

    logger.info('QuickSwap data fetching completed successfully.');
  } catch (error) {
    logger.error('Error fetching QuickSwap data:', error.message);
    logger.error('Detailed error:', error);
  }
}

fetchQuickSwapData();
