require('dotenv').config();
const axios = require('axios');
const logger = require('../monitoring/logger');

/**
 * Fetch GMX data using the specified endpoint type (tickers, signed_prices, or candles).
 * @param {string} network - The blockchain network (arbitrum or avalanche).
 * @param {string} endpointType - The endpoint type (e.g., tickers, signed_prices, candles).
 * @param {Object} [queryParams={}] - Optional query parameters for the endpoint.
 * @returns {Object} - The fetched data.
 */
async function fetchGmxData(network, endpointType, queryParams = {}) {
    try {
        const endpoint = process.env[`GMX_${network.toUpperCase()}_${endpointType.toUpperCase()}_URL`];
        if (!endpoint) {
            throw new Error(`Missing API endpoint for ${network} and ${endpointType} in .env`);
        }

        logger.info(`Fetching GMX data for ${network} (${endpointType}) with params: ${JSON.stringify(queryParams)}`);
        const response = await axios.get(endpoint, { params: queryParams });

        if (response.status !== 200) {
            throw new Error(`Unexpected response status: ${response.status}`);
        }

        logger.info(`Fetched GMX data: ${JSON.stringify(response.data)}`);
        return response.data;
    } catch (error) {
        logger.error(`Error fetching GMX data (${network}, ${endpointType}): ${error.message}`);
        throw error;
    }
}

/**
 * Fetch candlestick data for GMX tokens.
 * @param {string} network - The blockchain network (arbitrum or avalanche).
 * @param {string} tokenSymbol - The token symbol (e.g., ETH, AVAX).
 * @param {string} period - The candlestick period (e.g., 1m, 1d).
 * @returns {Object} - The candlestick data.
 */
async function fetchGmxCandlesticks(network, tokenSymbol, period) {
    return await fetchGmxData(network, 'candles', { tokenSymbol, period });
}

module.exports = { fetchGmxData, fetchGmxCandlesticks };
