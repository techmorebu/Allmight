const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const SUSHISWAP_API_URL = process.env.SUSHISWAP_API_URL || 'https://api.thegraph.com/subgraphs/name/sushiswap/exchange';

/**
 * Fetch pair-level data from SushiSwap REST API
 */
async function fetchSushiSwapPairData(limit = 10, order = 'desc', sort = 'volumeUSD') {
    try {
        const endpoint = `${SUSHISWAP_API_URL}/pairs?limit=${limit}&order=${order}&sort=${sort}`;

        // Fetch data from the API
        const response = await axios.get(endpoint);

        if (!response.data || !response.data.data) {
            throw new Error('Invalid response structure');
        }

        // Map the response data to a usable format
        return response.data.data.map(pair => {
            if (!pair.token0 || !pair.token1) throw new Error('Missing token data');
            return {
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
            };
        });
    } catch (error) {
        logger.error(`Error fetching SushiSwap pair data: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchSushiSwapPairData };
