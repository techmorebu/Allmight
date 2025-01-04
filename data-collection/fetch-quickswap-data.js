const { logger } = require('../monitoring/logger');
const axios = require('axios');
const redis = require('../utils/redis');

const QUICKSWAP_API_URL = process.env.QUICKSWAP_API;

const fetchQuickswapData = async () => {
    try {
        logger.info('Starting QuickSwap data fetcher...');
        logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API_URL}`);
        
        const response = await axios.post(QUICKSWAP_API_URL, {
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
                        txCount
                    }
                }
            `
        });

        // Check for valid response
        if (!response.data || !response.data.data || !response.data.data.pairs) {
            logger.error('Invalid or null response from QuickSwap API.');
            logger.error('Detailed error:', response.data);
            return;
        }

        const pools = response.data.data.pairs;

        if (pools.length === 0) {
            logger.error('No pools found in QuickSwap API response.');
            return;
        }

        logger.info(`Fetched ${pools.length} pools from QuickSwap API.`);

        // Store each pool in Redis
        for (const pool of pools) {
            const redisKey = `quickswap:pool:${pool.id}`;
            await redis.set(redisKey, JSON.stringify(pool));
            logger.info(`Stored pool data in Redis with key: ${redisKey}`);
        }

        logger.info('QuickSwap data fetching completed successfully.');

    } catch (error) {
        logger.error('Error fetching QuickSwap data:', error.message);
        logger.error('Detailed error:', error);
    }
};

fetchQuickswapData();
