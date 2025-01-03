const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

// Load environment variables
require('dotenv').config();

const MIDGARD_API_URL = process.env.MIDGARD_API_URL || 'https://midgard.ninerealms.com/v2';

const redis = new Redis();

async function fetchThorchainData() {
    try {
        logger.info('Fetching Thorchain pool data...');
        const poolData = await axios.get(`${MIDGARD_API_URL}/pools`);
        logger.info('Fetched Thorchain pool data successfully.');
        await redis.set('thorchain:pools', JSON.stringify(poolData.data));
        logger.info('Stored Thorchain pool data in Redis.');

       logger.info('Fetching Thorchain swap data...');
        const swapData = await axios.get(`${MIDGARD_API_URL}/actions`, {
        params: { type: 'swap', limit: 10 } // Adjust parameters as needed.
        });
        logger.info('Fetched Thorchain swap data successfully.');
        await redis.set('thorchain:swaps', JSON.stringify(swapData.data));
        logger.info('Stored Thorchain swap data in Redis.');


        logger.info('Fetching Thorchain fee data...');
        const feeData = await axios.get(`${MIDGARD_API_URL}/network`);
        logger.info('Fetched Thorchain fee data successfully.');
        await redis.set('thorchain:fees', JSON.stringify(feeData.data));
        logger.info('Stored Thorchain fee data in Redis.');
    } catch (error) {
        logger.error(`Error in Thorchain fetcher: ${error.message}`);
        if (error.response) {
            logger.error(`Response status: ${error.response.status}`);
            logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
    } finally {
        redis.disconnect();
    }
}

fetchThorchainData();
