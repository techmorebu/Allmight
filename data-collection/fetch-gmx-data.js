require('dotenv').config();
const axios = require('axios');
const { logger } = require('../monitoring/logger');

async function fetchGmxTokenPrices(network) {
    const pricesUrl = network === 'arbitrum'
        ? process.env.GMX_ARBITRUM_PRICES_URL
        : process.env.GMX_AVALANCHE_PRICES_URL;

    if (!pricesUrl) {
        logger.error(`GMX token prices URL not found for network: ${network}`);
        throw new Error(`Missing URL for GMX token prices on ${network}`);
    }

    try {
        logger.info(`Fetching GMX token prices from ${network}...`);
        const response = await axios.get(pricesUrl);

        if (response.status !== 200 || !response.data) {
            throw new Error(`Unexpected response from GMX token prices API (${response.status}): ${response.data}`);
        }

        logger.info('Token prices fetched successfully:', JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (error) {
        logger.error(`Error fetching GMX token prices for ${network}: ${error.message}`);
        return null;
    }
}

async function fetchGmxPairs(network) {
    const pairsUrl = network === 'arbitrum'
        ? process.env.GMX_ARBITRUM_PAIRS_URL
        : process.env.GMX_AVALANCHE_PAIRS_URL;

    if (!pairsUrl) {
        logger.error(`GMX pairs URL not found for network: ${network}`);
        throw new Error(`Missing URL for GMX pairs on ${network}`);
    }

    try {
        logger.info(`Fetching GMX pairs from ${network}...`);
        const response = await axios.get(pairsUrl);

        if (response.status !== 200 || !response.data) {
            throw new Error(`Unexpected response from GMX pairs API (${response.status}): ${response.data}`);
        }

        logger.info('Pairs fetched successfully:', JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (error) {
        logger.error(`Error fetching GMX pairs for ${network}: ${error.message}`);
        return null;
    }
}

module.exports = { fetchGmxTokenPrices, fetchGmxPairs };
