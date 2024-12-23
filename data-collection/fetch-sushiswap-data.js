const axios = require('axios');
const logger = require('../monitoring/logger');
require('dotenv').config();

const SUSHISWAP_SUBGRAPH_URL = process.env.SUSHISWAP_SUBGRAPH_URL;

async function fetchSushiSwapPairData() {
    try {
        logger.info('Fetching SushiSwap pair data...');
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

        // Check for valid structure in response
        if (!response || !response.data || !response.data.data || !response.data.data.liquidityPools) {
            logger.error('Invalid response structure or missing data');
            throw new Error('Response data is missing required fields');
        }

        logger.info('SushiSwap pair data fetched successfully');
        return response.data.data.liquidityPools.map(pool => ({
            id: pool.id,
            name: pool.name,
            tokens: pool.inputTokens.map(token => ({
                symbol: token.symbol,
                decimals: parseInt(token.decimals, 10),
            })),
            totalValueLockedUSD: parseFloat(pool.totalValueLockedUSD),
        }));
    } catch (error) {
        logger.error(`Error fetching SushiSwap pair data: ${error.message}`);
        throw error; // Ensure the error propagates correctly for higher-level handling
    }
}

module.exports = { fetchSushiSwapPairData };
