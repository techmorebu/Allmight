require('dotenv').config({ path: './.env' });
const axios = require('axios');
const { logger } = require('../monitoring/logger');

async function fetchGmxData(network, endpointType, queryParams = {}) {
    try {
        const endpoint = process.env[`GMX_${network.toUpperCase()}_${endpointType.toUpperCase()}_URL`];
        if (!endpoint) throw new Error(`Missing API endpoint for ${network} and ${endpointType} in .env`);

        logger.info(`Fetching GMX data: ${network} (${endpointType})`);
        const response = await axios.get(endpoint, { params: queryParams });

        if (response.status !== 200) throw new Error(`Unexpected response status: ${response.status}`);
        return response.data;
    } catch (error) {
        logger.error(`Error fetching GMX data: ${error.message}`);
        throw error;
    }
}

async function fetchGmxCandlesticks(network, tokenSymbol, period) {
    return await fetchGmxData(network, 'candles', { tokenSymbol, period });
}

module.exports = { fetchGmxData, fetchGmxCandlesticks };
