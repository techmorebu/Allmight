const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const UNISWAP_SUBGRAPH_URL = process.env.UNISWAP_SUBGRAPH_URL;

async function fetchUniswapPairData() {
    try {
        const query = `
        {
            pools(first: 10, orderBy: volumeUSD, orderDirection: desc) {
                id
                token0 { symbol, decimals }
                token1 { symbol, decimals }
                token0Price
                token1Price
                volumeUSD
                liquidity
            }
        }`;

        const response = await axios.post(UNISWAP_SUBGRAPH_URL, { query });

        if (response.data && response.data.data && response.data.data.pools) {
            const pairs = response.data.data.pools.map(pool => ({
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

            logger.info('Successfully fetched Uniswap pair-level data', { pairCount: pairs.length });
            return pairs;
        } else {
            throw new Error('Invalid response structure');
        }
    } catch (error) {
        logger.error(`Error fetching Uniswap pair-level data: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchUniswapPairData };
