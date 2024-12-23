const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const UNISWAP_SUBGRAPH_URL = process.env.UNISWAP_SUBGRAPH_URL;

async function fetchUniswapData() {
    try {
        const query = `
        {
            pools(first: 10, orderBy: volumeUSD, orderDirection: desc) {
                id
                token0 { symbol }
                token1 { symbol }
                volumeUSD
                liquidity
            }
        }`;

        const response = await axios.post(UNISWAP_SUBGRAPH_URL, { query });
        return response.data.data.pools.map(pool => ({
            id: pool.id,
            pair: `${pool.token0.symbol}/${pool.token1.symbol}`,
            volumeUSD: parseFloat(pool.volumeUSD),
            liquidity: parseFloat(pool.liquidity),
        }));
    } catch (error) {
        logger.error(`Error fetching Uniswap data: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchUniswapData };
