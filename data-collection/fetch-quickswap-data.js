const axios = require('axios');
const { logger } = require('../monitoring/logger');
const redis = require('redis');

// Environment variables
require('dotenv').config();
const QUICKSWAP_API = process.env.QUICKSWAP_API;
const redisClient = redis.createClient();

redisClient.on('error', (err) => logger.error(`Redis error: ${err}`));

async function fetchQuickSwapData() {
    try {
        logger.info('Starting QuickSwap data fetcher...');
        logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);
        
        // GraphQL query for pools
        const query = `
        {
            pools(first: 10, orderBy: volumeUSD, orderDirection: desc) {
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
                totalValueLockedUSD
                txCount
            }
        }`;

        const response = await axios.post(QUICKSWAP_API, { query });

        if (!response.data || !response.data.data || !response.data.data.pools) {
            throw new Error('Invalid or null response from QuickSwap API.');
        }

        const pools = response.data.data.pools;
        logger.info(`Fetched ${pools.length} pools from QuickSwap API.`);

        // Store each pool in Redis
        pools.forEach((pool) => {
            const key = `quickswap:pool:${pool.id}`;
            redisClient.set(key, JSON.stringify(pool), (err) => {
                if (err) {
                    logger.error(`Failed to store data in Redis for pool: ${pool.id}`);
                } else {
                    logger.info(`Stored pool data in Redis with key: ${key}`);
                }
            });
        });

        logger.info('QuickSwap data fetching and storage completed successfully.');
    } catch (error) {
        logger.error(`Error fetching QuickSwap data: ${error.message}`);
        if (error.response) {
            logger.error(`Response status: ${error.response.status}`);
            logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
    } finally {
        redisClient.quit();
    }
}

fetchQuickSwapData();
