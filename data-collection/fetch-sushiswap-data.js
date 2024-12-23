// Required libraries
const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const SUSHISWAP_SUBGRAPH_URL = process.env.SUSHISWAP_SUBGRAPH_URL || 'https://api.thegraph.com/subgraphs/name/sushiswap/exchange';

/**
 * Fetch pair-level data from SushiSwap using The Graph API
 */
async function fetchSushiSwapData() {
    try {
        const query = `
        {
            pairs(first: 10, orderBy: volumeUSD, orderDirection: desc) {
                id
                token0 { symbol }
                token1 { symbol }
                reserveUSD
                volumeUSD
            }
        }`;

        const response = await axios.post(SUSHISWAP_SUBGRAPH_URL, { query });
        return response.data.data.pairs.map(pair => ({
            id: pair.id,
            pair: `${pair.token0.symbol}/${pair.token1.symbol}`,
            volumeUSD: parseFloat(pair.volumeUSD),
            liquidityUSD: parseFloat(pair.reserveUSD),
        }));
    } catch (error) {
        logger.error(`Error fetching SushiSwap data: ${error.message}`);
        throw error;
    }
}

// Export the fetch function
module.exports = { fetchSushiSwapData };
