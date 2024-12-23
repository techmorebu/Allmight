const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const SUSHISWAP_SUBGRAPH_URL = process.env.SUSHISWAP_SUBGRAPH_URL;

async function fetchSushiswapPairData() {
    try {
        const query = 
        {
            pools(first: 10, orderBy: volumeUSD, orderDirection: desc) {
                id
                token0 { symbol decimals }
                token1 { symbol decimals }
                token0Price
                token1Price
                volumeUSD
                liquidity
            }
        }`;

        const response = await axios.post(SUSHISWAP_SUBGRAPH_URL, { query });
        if (response.data && response.data.data && response.data.data.pools) {
            return response.data.data.pools.map(pool => ({
                pair: `${pool.token0.symbol}/${pool.token1.symbol}`,
                token0: {
                    symbol: pool.token0.symbol,
                    price: parseFloat(pool.token0Price),
                    decimals: parseInt(pool.token0.decimals),
                },
                token1: {
                    symbol: pool.token1.symbol,
                    price: parseFloat(pool.token1Price),
                    decimals: parseInt(pool.token1.decimals),
                },
                volumeUSD: parseFloat(pool.volumeUSD),
                liquidity: parseFloat(pool.liquidity),
            }));
        } else {
            throw new Error('Invalid response structure');
        }
    } catch (error) {
        logger.error(`Error fetching Sushiswap pair data: ${error.message}`);
        throw error; // Ensure the error is re-thrown for testing.
    }
}

module.exports = { fetchSushiswapPairData };
