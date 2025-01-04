const axios = require('axios');
const { createClient } = require('redis');
const { logger } = require('../monitoring/logger');
require('dotenv').config();


// QuickSwap API URL from .env
const QUICKSWAP_API = process.env.QUICKSWAP_API;

// Redis client setup
const redisClient = createClient();

async function fetchQuickSwapData() {
    try {
        logger.info('Starting QuickSwap data fetcher...');

        // Connect to Redis
        await redisClient.connect();

        // Fetch data from QuickSwap API
        logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);
        const response = await axios.post(QUICKSWAP_API, {
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
                        volumeUSD
                        totalLiquidity
                    }
                }
            `
        });

        const pools = response.data?.data?.pools;

        if (!pools || pools.length === 0) {
            logger.error('No pools data found in the API response.');
            return;
        }

        logger.info(`Fetched ${pools.length} pools from QuickSwap API.`);

        // Store data in Redis
        await redisClient.set('quickswap:pools', JSON.stringify(pools));
        logger.info('QuickSwap data fetching and storage completed successfully.');
    } catch (error) {
        logger.error(`Error fetching QuickSwap data: ${error.message}`);
    } finally {
        // Ensure Redis client is properly closed
        try {
            await redisClient.quit();
            logger.info('Redis client closed successfully.');
        } catch (quitError) {
            logger.error(`Error closing Redis client: ${quitError.message}`);
        }
    }
}

fetchQuickSwapData();
