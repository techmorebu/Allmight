const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const SUSHISWAP_API_URL = process.env.SUSHISWAP_API_URL;

/**
 * Fetch pair-level data from SushiSwap REST API
 */
async function fetchSushiSwapPairData() {
    try {
        const endpoint = `${SUSHISWAP_API_URL}/pairs?limit=10&order=desc&sort=volumeUSD`;

        // Fetch data from the API
        const response = await axios.get(endpoint);

        if (!response.data || !response.data.data) {
            throw new Error('Invalid response structure');
        }

        // Map the response data to a usable format
        return response.data.data.map(pair => ({
            pair: `${pair.token0.symbol}/${pair.token1.symbol}`,
            token0: {
                symbol: pair.token0.symbol,
                decimals: parseInt(pair.token0.decimals || 0),
            },
            token1: {
                symbol: pair.token1.symbol,
                decimals: parseInt(pair.token1.decimals || 0),
            },
            volumeUSD: parseFloat(pair.volumeUSD || 0),
            reserveUSD: parseFloat(pair.reserveUSD || 0),
        }));
    } catch (error) {
        logger.error(`Error fetching SushiSwap pair data: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchSushiSwapPairData };
