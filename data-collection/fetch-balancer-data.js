require('dotenv').config();
const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const redis = new Redis();

const chainUrls = {
  ETHEREUM: process.env.BALANCER_ETHEREUM,
  POLYGON: process.env.BALANCER_POLYGON,
  OPTIMISM: process.env.BALANCER_OPTIMISM,
  ARBITRUM: process.env.BALANCER_ARBITRUM,
  AVALANCHE: process.env.BALANCER_AVALANCHE,
};

const fetchBalancerData = async () => {
  try {
    const chain = process.env.BALANCER_DEFAULT_CHAIN || 'ETHEREUM';
    const url = chainUrls[chain];

    if (!url) {
      throw new Error(`No API URL found for chain: ${chain}`);
    }

    logger.info(`Fetching Balancer data for chain: ${chain} using URL: ${url}...`);

    const query = `
      {
        pools(first: 10) {
          id
          address
          tokens {
            symbol
            address
            balance
          }
          swapFee
          totalLiquidity
        }
      }
    `;

    const response = await axios.post(url, { query });

    if (response.status !== 200 || !response.data.data) {
      throw new Error(`Failed to fetch data from Balancer. Response status: ${response.status}`);
    }

    const pools = response.data.data.pools;

    logger.info(`Fetched ${pools.length} Balancer pools. Storing in Redis...`);

    for (const pool of pools) {
      const key = `balancer:pool:${chain.toLowerCase()}:${pool.id}`;
      await redis.set(key, JSON.stringify(pool));
      logger.info(`Stored pool data in Redis with key: ${key}`);
    }

    logger.info(`Balancer fetcher script completed successfully.`);
  } catch (error) {
    logger.error(`Error in Balancer fetcher: ${error.message}`);
  } finally {
    redis.disconnect();
  }
};

fetchBalancerData();
