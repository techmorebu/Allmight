const axios = require('axios');
const redis = require('redis');
const { promisify } = require('util');
const { logger } = require('../monitoring/logger');

// Set up Redis client
const redisClient = redis.createClient();
const setAsync = promisify(redisClient.set).bind(redisClient);

const QUICKSWAP_API_URL = process.env.QUICKSWAP_API || 'https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g';

async function fetchQuickSwapData() {
    try {
        logger.info('Starting QuickSwap data fetcher...');
        logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API_URL}`);

        const response = await axios.post(QUICKSWAP_API_URL, {
            query: `
                {
                    pairs(first: 100) {
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

        logger.info('Full API response:', response.data);

        if (!response.data || !response.data.data || !response.data.data.pairs) {
            throw new Error('Invalid or null response from QuickSwap API.');
        }

        const pairs = response.data.data.pairs;

        if (pairs.length === 0) {
            logger.warn('No pairs data found from QuickSwap API.');
            return;
        }

        logger.info(`Fetched ${pairs.length} pairs from QuickSwap API.`);

        for (const pair of pairs) {
            const key = `quickswap:pair:${pair.id}`;
            await setAsync(key, JSON.stringify(pair));
            logger.info(`Stored pair data in Redis with key: ${key}`);
        }

        logger.info('QuickSwap data fetcher completed successfully.');
    } catch (error) {
        logger.error('Error fetching QuickSwap data:', error.message);
        logger.error('Detailed error:', error);
    } finally {
        redisClient.quit();
    }
}

fetchQuickSwapData();
