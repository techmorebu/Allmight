const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

// Environment variables
require('dotenv').config();

const QUICKSWAP_API = process.env.QUICKSWAP_API;
const redis = new Redis();

const fetchQuickswapData = async () => {
    logger.info('Starting QuickSwap data fetcher...');

    try {
        if (!QUICKSWAP_API) {
            throw new Error('QuickSwap API URL is not set in the environment variables.');
        }

        logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);

        // GraphQL query (adapted from Balancer's schema)
        const query = `
        {
            pools(first: 100, orderBy: volumeUSD, orderDirection: desc) {
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
                reserve0
                reserve1
                totalSupply
                volumeUSD
            }
        }
        `;

        const response = await axios.post(QUICKSWAP_API, { query });

        // Validate response
        if (!response || !response.data || !response.data.data || !response.data.data.pools) {
            logger.error('Invalid or null response from QuickSwap API.');
            logger.error('Detailed error:', response.data || 'No additional details available.');
            return;
        }

        const pools = response.data.data.pools;

        if (pools.length === 0) {
            logger.warn('No pools data found in QuickSwap API response.');
            return;
        }

        logger.info(`Fetched ${pools.length} pools from QuickSwap.`);

        // Store pools in Redis
        for (const pool of pools) {
            const redisKey = `quickswap:pool:${pool.id}`;
            await redis.set(redisKey, JSON.stringify(pool));
            logger.info(`Stored pool data in Redis: ${redisKey}`);
        }

        logger.info('QuickSwap data fetcher completed successfully.');
    } catch (error) {
        logger.error(`Error fetching QuickSwap data: ${error.message}`);
        if (error.response && error.response.data) {
            logger.error('Detailed error:', error.response.data);
        }
    } finally {
        redis.quit();
    }
};

fetchQuickswapData();
