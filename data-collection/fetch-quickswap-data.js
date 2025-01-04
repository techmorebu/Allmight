require('dotenv').config();
const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const QUICKSWAP_API = process.env.QUICKSWAP_API;
const redis = new Redis();

async function fetchQuickSwapData() {
    try {
        logger.info('Starting QuickSwap data fetcher...');

        // Validate API URL
        if (!QUICKSWAP_API) {
            logger.error('QuickSwap API URL is missing from .env file.');
            throw new Error('QuickSwap API URL is required.');
        }

        logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);
        const response = await axios.post(QUICKSWAP_API, {
            query: `
                {
                    pools(first: 10, orderBy: totalLiquidity, orderDirection: desc) {
                        id
                        token0 {
                            id
                            symbol
                        }
                        token1 {
                            id
                            symbol
                        }
                        volumeUSD
                        totalLiquidity
                        swaps(first: 5, orderBy: timestamp, orderDirection: desc) {
                            id
                            amountUSD
                            timestamp
                        }
                    }
                }
            `
        });

        // Check for null or invalid responses
        if (!response || !response.data || !response.data.data || !response.data.data.pools) {
            logger.error('Invalid or null response from QuickSwap API.');
            throw new Error('Invalid or null response from QuickSwap API.');
        }

        const pools = response.data.data.pools;
        logger.info(`Fetched ${pools.length} pools from QuickSwap.`);

        // Store pool data in Redis
        for (const pool of pools) {
            const key = `quickswap:pool:${pool.id}`;
            await redis.set(key, JSON.stringify(pool));
            logger.info(`Stored pool data in Redis with key: ${key}`);
        }

        logger.info('QuickSwap data fetcher completed successfully.');
    } catch (error) {
        logger.error(`Error fetching QuickSwap data: ${error.message}`);
        logger.error(`Detailed error: ${error.stack}`);
    } finally {
        redis.disconnect();
    }
}

// Run the fetcher
fetchQuickSwapData();
