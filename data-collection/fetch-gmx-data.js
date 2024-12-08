const axios = require('axios');
const { logger } = require('../monitoring/logger');

/**
 * Fetch GMX token prices for the given network.
 * @param {string} network - The network to fetch prices for ('arbitrum' or 'avalanche').
 * @returns {Promise<Object>} - The GMX token price data.
 */
async function fetchGmxTokenPrices(network) {
    try {
        logger.info(`Fetching GMX prices for ${network}...`);

        // Replace with actual GMX API endpoint and parameters
        const endpoint = network === 'arbitrum'
            ? 'https://api.gmx-arbitrum.com/prices'
            : 'https://api.gmx-avalanche.com/prices';

        const response = await axios.get(endpoint);
        const prices = response.data;

        if (!prices || Object.keys(prices).length === 0) {
            throw new Error(`No price data returned for ${network}.`);
        }

        logger.info(`GMX prices fetched for ${network}:`, prices);
        return prices;
    } catch (error) {
        logger.error(`Error fetching GMX prices for ${network}: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchGmxTokenPrices };
