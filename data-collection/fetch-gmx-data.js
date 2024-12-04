require('dotenv').config();
const axios = require('axios');
const { logger } = require('../monitoring/logger');

// Fetch GMX Token Prices
async function fetchGmxTokenPrices(network) {
    const pricesUrl = network === 'arbitrum'
        ? process.env.GMX_ARBITRUM_PRICES_URL
        : process.env.GMX_AVALANCHE_PRICES_URL;

    try {
        logger.info(`Fetching GMX token prices from ${network}...`);
        const response = await axios.get(pricesUrl);
        logger.info('Token prices fetched successfully.');
        return response.data;
    } catch (error) {
        logger.error(`Error fetching token prices: ${error.message}`);
        throw error;
    }
}

// Fetch GMX Pairs
async function fetchGmxPairs(network) {
    const pairsUrl = network === 'arbitrum'
        ? process.env.GMX_ARBITRUM_PAIRS_URL
        : process.env.GMX_AVALANCHE_PAIRS_URL;

    try {
        logger.info(`Fetching GMX pairs from ${network}...`);
        const response = await axios.get(pairsUrl);
        logger.info('Pairs fetched successfully.');
        return response.data;
    } catch (error) {
        logger.error(`Error fetching pairs: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchGmxTokenPrices, fetchGmxPairs };

// Test Example
if (require.main === module) {
    (async () => {
        const prices = await fetchGmxTokenPrices('arbitrum');
        console.log('Token Prices:', prices);

        const pairs = await fetchGmxPairs('avalanche');
        console.log('Pairs:', pairs);
    })();
}
