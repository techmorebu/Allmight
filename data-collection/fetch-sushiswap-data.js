require('dotenv').config();
const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const redisClient = new Redis();

const SUSHISWAP_API_URL = process.env.SUSHISWAP_API_URL || 'https://gateway.thegraph.com/api/YOUR_API_KEY/subgraphs/id/YOUR_SUBGRAPH_ID';

async function fetchSushiSwapData() {
    try {
        logger.info(`Using SushiSwap API URL: ${SUSHISWAP_API_URL}`);

        // Fetch pool data from SushiSwap API
        const response = await axios.post(SUSHISWAP_API_URL, {
            query: `
                {
                    pools(first: 10) {
                        id
                        token0 {
                            id
                            symbol
                        }
                        token1 {
                            id
                            symbol
                        }
                        totalValueLockedUSD
                        volumeUSD
                        feesUSD
                    }
                }
            `
        });

        // Log raw response for debugging
        logger.debug(`Raw API response: ${JSON.stringify(response.data, null, 2)}`);

        if (response.data && response.data.data && response.data.data.pools) {
            const pools = response.data.data.pools;

            logger.info(`Fetched ${pools.length} pools from SushiSwap.`);

            // Store each pool in Redis
            for (const pool of pools) {
                const redisKey = `sushiswap:pool:${pool.id}`;
                await redisClient.set(redisKey, JSON.stringify(pool));
                logger.info(`Stored pool data in Redis under key: ${redisKey}`);
            }

            logger.info('All pool data stored successfully.');
        } else {
            logger.error('No pool data found in the response.');
        }
    } catch (error) {
        logger.error(`Error in SushiSwap fetcher: ${error.message}`);
        if (error.response) {
            logger.error(`Response status: ${error.response.status}`);
            logger.error(`Response data: ${error.response.data}`);
        }
    } finally {
        redisClient.disconnect();
        logger.info('Redis connection closed.');
    }
}

fetchSushiSwapData();
