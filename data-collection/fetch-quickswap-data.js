require('dotenv').config();
const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const QUICKSWAP_API = process.env.QUICKSWAP_API;
const redis = new Redis();

async function fetchQuickSwapData() {
  logger.info('Fetching QuickSwap data...');
  try {
    const response = await axios.post(QUICKSWAP_API, {
      query: `
        {
          pairs(first: 10) {
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
        }
      `,
    });

    const pairs = response.data.data.pairs;

    if (!pairs || pairs.length === 0) {
      logger.warn('No pairs fetched from QuickSwap API.');
      return;
    }

    logger.info(`Fetched ${pairs.length} pairs from QuickSwap.`);
    for (const pair of pairs) {
      const redisKey = `quickswap:pair:${pair.id}`;
      await redis.set(redisKey, JSON.stringify(pair));
      logger.info(`Stored pair data in Redis: ${redisKey}`);
    }

    logger.info('QuickSwap data fetching completed successfully.');
  } catch (error) {
    logger.error(`Error fetching QuickSwap data: ${error.message}`);
  } finally {
    redis.quit();
  }
}

fetchQuickSwapData();
