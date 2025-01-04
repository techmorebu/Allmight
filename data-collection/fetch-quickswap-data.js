const { logger } = require('../monitoring/logger');
const axios = require('axios');
const Redis = require('ioredis');
require('dotenv').config();

const QUICKSWAP_API_URL = process.env.QUICKSWAP_API;
const redis = new Redis();

async function fetchQuickSwapData() {
    try {
        logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API_URL}`);

        const response = await axios.post(QUICKSWAP_API_URL, {
            query: `
                {
                    pairs(first: 10) {
                        id
                        token0 {
                            symbol
                        }
                        token1 {
                            symbol
                        }
                        reserveUSD
                        volumeUSD
                    }
                }
            `
        });

        if (!response.data || !response.data.data || !response.data.data.pairs) {
            throw new Error('Invalid or null response from QuickSwap API.');
        }

        const pairs = response.data.data.pairs;
        logger.info(`Fetched ${pairs.length} pairs from QuickSwap API.`);

        // Store pairs in Redis
        for (const pair of pairs) {
            const redisKey = `quickswap:pair:${pair.id}`;
            await redis.set(redisKey, JSON.stringify(pair));
            logger.info(`Stored pair ${pair.id} in Redis.`);
        }

        logger.info('QuickSwap data fetching completed successfully.');
    } catch (error) {
        logger.error('Error fetching QuickSwap data:', error.message);
        logger.error('Detailed error:', error);
    } finally {
        if (!redis.status || redis.status === 'end') {
            logger.warn('Redis client is already closed.');
        } else {
            await redis.quit();
            logger.info('Redis client closed.');
        }
    }
}

// Run the fetcher
fetchQuickSwapData();
