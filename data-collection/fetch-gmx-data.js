require('dotenv').config({ path: '../.env' });
const axios = require('axios');
const { logger } = require('../monitoring/logger');

/**
 * Fetch GMX token prices using the specified endpoint type (tickers, signed_prices, or candles).
 * @param {string} network - The blockchain network (arbitrum or avalanche).
 * @param {string} endpointType - The type of endpoint (e.g., tickers, signed_prices, candles).
 * @param {Object} [queryParams] - Optional query parameters for the endpoint.
 * @returns {Object} - The fetched data.
 */
async function fetchGmxData(network, endpointType, queryParams = {}) {
    try {
        const endpoint = process.env[`GMX_${network.toUpperCase()}_${endpointType.toUpperCase()}_URL`];
        if (!endpoint) {
            throw new Error(`Missing API endpoint for ${network} and endpoint type ${endpointType} in .env`);
        }

        logger.info(`Fetching GMX data for ${network} using ${endpointType} endpoint with params: ${JSON.stringify(queryParams)}`);
        const response = await axios.get(endpoint, { params: queryParams });

        if (response.status !== 200) {
            throw new Error(`Unexpected response status: ${response.status}`);
        }

        const data = response.data;
        logger.info(`Fetched data for ${network}: ${JSON.stringify(data)}`);
        return data;
    } catch (error) {
        logger.error(`Error fetching GMX data for ${network}: ${error.message}`);
        throw error;
    }
}

/**
 * Fetch candlestick data for GMX tokens.
 * @param {string} network - The blockchain network (arbitrum or avalanche).
 * @param {string} tokenSymbol - The symbol of the token (e.g., ETH, AVAX).
 * @param {string} period - The candlestick period (e.g., 1m, 5m, 15m, 1h, 4h, 1d).
 * @returns {Object} - The fetched candlestick data.
 */
async function fetchGmxCandlesticks(network, tokenSymbol, period) {
    return await fetchGmxData(network, 'candles', { tokenSymbol, period });
}

module.exports = { fetchGmxData, fetchGmxCandlesticks };
