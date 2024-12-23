const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const SUSHISWAP_SUBGRAPH_URL = process.env.SUSHISWAP_SUBGRAPH_URL;

/**
 * Fetch SushiSwap pair-level data
 */
async function fetchSushiSwapPairData() {
    try {
        const query = `
        {
            pairs(first: 10, orderBy: volumeUSD, orderDirection: desc) {
                id
                token0 { symbol }
                token1 { symbol }
                volumeUSD
                reserveUSD
            }
        }`;

        const response = await axios.post(SUSHISWAP_SUBGRAPH_URL, { query });

        // Ensure response structure is valid
        if (!response.data || !response.data.data || !response.data.data.pairs) {
            throw new Error('Invalid response structure from SushiSwap API');
        }

        return response.data.data.pairs.map(pair => ({
            id: pair.id,
            pair: `${pair.token0.symbol}/${pair.token1.symbol}`,
            volumeUSD: parseFloat(pair.volumeUSD),
            reserveUSD: parseFloat(pair.reserveUSD),
        }));
    } catch (error) {
        logger.error(`Error fetching SushiSwap pair data: ${error.message}`);
        throw new Error(`Fetcher failed: ${error.message}`);
    }
}

module.exports = { fetchSushiSwapPairData };
