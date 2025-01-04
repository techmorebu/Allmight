const axios = require('axios');
const { createClient } = require('redis');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const QUICKSWAP_API = process.env.QUICKSWAP_API || "https://gateway.thegraph.com/api/YOUR_API_KEY_HERE";
const redisClient = createClient();

async function fetchQuickSwapData() {
    logger.info('Starting QuickSwap data fetcher...');

    try {
        logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);
        const query = `
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
        `;
        const response = await axios.post(QUICKSWAP_API, { query });

        if (!response.data || !response.data.data || !response.data.data.pairs) {
            throw new Error('Invalid or null response from QuickSwap API.');
        }

        logger.info('Fetched QuickSwap pair data successfully.');
        const pairs = response.data.data.pairs;
        logger.info(`Fetched ${pairs.length} QuickSwap pairs.`);

        await redisClient.connect();

        for (const pair of pairs) {
            await redisClient.set(`quickswap:pair:${pair.id}`, JSON.stringify(pair));
        }
        logger.info('Stored QuickSwap pairs in Redis.');
    } catch (error) {
        logger.error(`Error fetching QuickSwap data: ${error.message}`);
        if (error.response) {
            logger.error(`Response status: ${error.response.status}`);
            logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
    } finally {
        if (redisClient.isOpen) {
            await redisClient.quit();
        }
    }
    logger.info('QuickSwap data fetcher completed.');
}

fetchQuickSwapData();
