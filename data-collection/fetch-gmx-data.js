require('dotenv').config({ path: '../../.env' });
const axios = require('axios');
const { logger } = require('../monitoring/logger');

async function fetchGmxTokenPrices(network) {
    try {
        logger.info(`Fetching GMX prices for ${network}...`);
        
        // Load the appropriate endpoint from .env
        const endpoint = network === 'arbitrum'
            ? process.env.GMX_ARBITRUM_ENDPOINT
            : process.env.GMX_AVALANCHE_ENDPOINT;

        if (!endpoint) {
            throw new Error(`Missing API endpoint for ${network} in .env`);
        }

        // Make the API request
        const response = await axios.get(endpoint);

        if (response.status !== 200) {
            throw new Error(`Unexpected response status: ${response.status}`);
        }

        // Assuming the API returns data in JSON format
        const prices = response.data;

        logger.info(`Fetched GMX prices for ${network}: ${JSON.stringify(prices)}`);

        // Validate the structure of the fetched data
        if (!prices || typeof prices !== 'object') {
            throw new Error(`Invalid response format for ${network}: ${JSON.stringify(prices)}`);
        }

        return prices;
    } catch (error) {
        logger.error(`Error fetching GMX prices for ${network}: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchGmxTokenPrices };
