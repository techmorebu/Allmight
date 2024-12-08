require('dotenv').config({ path: '../../.env' });
const axios = require('axios');
const { logger } = require('../monitoring/logger');

async function fetchGmxTokenPrices(network, endpointType = 'tickers') {
    try {
        logger.info(`Fetching GMX prices for ${network} using ${endpointType} endpoint...`);

        // Determine the API endpoint based on the network and endpoint type
        const endpoints = {
            arbitrum: {
                tickers: process.env.GMX_ARBITRUM_TICKERS_URL,
                signedPrices: process.env.GMX_ARBITRUM_SIGNED_PRICES_URL,
                candles: process.env.GMX_ARBITRUM_CANDLES_URL,
                tokens: process.env.GMX_ARBITRUM_TOKENS_URL,
            },
            avalanche: {
                tickers: process.env.GMX_AVALANCHE_TICKERS_URL,
                signedPrices: process.env.GMX_AVALANCHE_SIGNED_PRICES_URL,
                candles: process.env.GMX_AVALANCHE_CANDLES_URL,
                tokens: process.env.GMX_AVALANCHE_TOKENS_URL,
            },
        };

        const endpoint = endpoints[network]?.[endpointType];

        if (!endpoint) {
            throw new Error(`Missing API endpoint for ${network} and endpoint type ${endpointType} in .env`);
        }

        // Configure the timeout using .env value or a default
        const timeout = Number(process.env.GMX_API_TIMEOUT) || 5000;

        // Make the API request
        const response = await axios.get(endpoint, { timeout });

        if (response.status !== 200) {
            throw new Error(`Unexpected response status: ${response.status}`);
        }

        // Assuming the API returns JSON data
        const data = response.data;

        logger.info(`Fetched GMX prices for ${network}: ${JSON.stringify(data)}`);

        // Validate the structure of the fetched data
        if (!data || typeof data !== 'object') {
            throw new Error(`Invalid response format for ${network}: ${JSON.stringify(data)}`);
        }

        return data;
    } catch (error) {
        logger.error(`Error fetching GMX prices for ${network}: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchGmxTokenPrices };
