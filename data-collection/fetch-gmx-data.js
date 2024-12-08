require('dotenv').config({ path: '../.env' });
const axios = require('axios');
const { logger } = require('../monitoring/logger');

async function fetchGmxTokenPrices(network, type) {
    try {
        logger.info(`Fetching GMX prices for ${network} using ${type} endpoint...`);

        const envKey = `GMX_${network.toUpperCase()}_${type.toUpperCase()}_URL`;
        const endpoint = process.env[envKey];
        console.log(`Loaded endpoint: ${envKey} = ${endpoint}`);

        if (!endpoint) {
            throw new Error(`Missing API endpoint for ${network} and endpoint type ${type} in .env`);
        }

        const response = await axios.get(endpoint);
        logger.info(`Fetched data for ${network}: ${JSON.stringify(response.data)}`);

        return response.data;
    } catch (error) {
        logger.error(`Error fetching GMX prices for ${network}: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchGmxTokenPrices };
