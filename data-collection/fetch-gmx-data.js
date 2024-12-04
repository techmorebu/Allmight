require('dotenv').config();
const axios = require('axios');
const { logger } = require('../monitoring/logger');

async function fetchGmxTokenPrices(network) {
    const pricesUrl = network === 'arbitrum'
        ? process.env.GMX_ARBITRUM_PRICES_URL
        : process.env.GMX_AVALANCHE_PRICES_URL;

    try {
        logger.info(`Fetching GMX token prices from ${network}...`);
        const response = await axios.get(pricesUrl);
        logger.info('Token prices fetched successfully:', JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (error) {
        logger.error(`Error fetching GMX token prices: ${error.message}`);
        return null;
    }
}

async function fetchGmxPairs(network) {
    const pairsUrl = network === 'arbitrum'
        ? process.env.GMX_ARBITRUM_PAIRS_URL
        : process.env.GMX_AVALANCHE_PAIRS_URL;

    try {
        logger.info(`Fetching GMX pairs from ${network}...`);
        const response = await axios.get(pairsUrl);
        logger.info('Pairs fetched successfully:', JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (error) {
        logger.error(`Error fetching GMX pairs: ${error.message}`);
        return null;
    }
}

module.exports = { fetchGmxTokenPrices, fetchGmxPairs };
