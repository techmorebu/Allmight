// Required libraries
const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const SUSHISWAP_SUBGRAPH_URL = process.env.SUSHISWAP_SUBGRAPH_URL;

/**
 * Fetch pair-level data from SushiSwap Subgraph
 */
async function fetchSushiSwapPairData() {
    try {
        const query = `{
            liquidityPools(first: 10, orderBy: totalValueLockedUSD, orderDirection: desc) {
                id
                name
                inputTokens {
                    symbol
                    decimals
                }
                totalValueLockedUSD
            }
        }`;

        const response = await axios.post(SUSHISWAP_SUBGRAPH_URL, { query });

        // Ensure the response contains the expected data
        if (response.data && response.data.data && response.data.data.liquidityPools) {
            return response.data.data.liquidityPools.map(pool => ({
                id: pool.id,
                name: pool.name,
                tokens: pool.inputTokens.map(token => ({
                    symbol: token.symbol,
                    decimals: parseInt(token.decimals, 10),
                })),
                totalValueLockedUSD: parseFloat(pool.totalValueLockedUSD),
            }));
        } else {
            throw new Error('Invalid response structure or missing liquidityPools data');
        }
    } catch (error) {
        logger.error(`Error fetching SushiSwap pair data: ${error.message}`);
        throw error; // Re-throw error for further handling
    }
}

module.exports = { fetchSushiSwapPairData };
