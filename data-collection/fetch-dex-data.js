require('dotenv').config();
const axios = require('axios');
const { logger } = require('../monitoring/logger');

// Mapping DEX names to their environment variables
const DEX_ENDPOINTS = {
    uniswap: process.env.UNISWAP_API_KEY,
    sushiswap: process.env.SUSHISWAP_API_KEY,
    curve: process.env.CURVE_FINANCE_ETHEREUM_API,
    quickswap: process.env.QUICKSWAP_API,
};

/**
 * Generic function to fetch data from a specified DEX.
 * @param {string} dex - The name of the DEX (e.g., 'uniswap', 'sushiswap').
 * @param {object} query - GraphQL query or REST parameters.
 * @returns {object} - The fetched data.
 */
async function fetchDexData(dex, query = {}) {
    try {
        const endpoint = DEX_ENDPOINTS[dex];
        if (!endpoint) throw new Error(`Endpoint for ${dex} is not defined in .env`);

        logger.info(`Fetching data from ${dex}...`);

        // For GraphQL-based DEXs
        if (dex === 'uniswap' || dex === 'sushiswap') {
            const response = await axios.post(endpoint, { query });
            return response.data;
        }

        // For REST APIs
        const response = await axios.get(endpoint, { params: query });
        return response.data;
    } catch (error) {
        logger.error(`Error fetching data from ${dex}: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchDexData };
