const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const SUSHISWAP_SUBGRAPH_URL = process.env.SUSHISWAP_SUBGRAPH_URL;

async function fetchSushiSwapPairData() {
    try {
        const query = `
        {
            pairs(first: 10, orderBy: volumeUSD, orderDirection: desc) {
                id
                token0 { symbol decimals }
                token1 { symbol decimals }
                reserve0
                reserve1
                volumeUSD
            }
        }`;

        const response = await axios.post(SUSHISWAP_SUBGRAPH_URL, { query });
        if (response.data && response.data.data && response.data.data.pairs) {
            return response.data.data.pairs.map(pair => ({
                pair: `${pair.token0.symbol}/${pair.token1.symbol}`,
                token0: {
                    symbol: pair.token0.symbol,
                    decimals: parseInt(pair.token0.decimals),
                    reserve: parseFloat(pair.reserve0),
                },
                token1: {
                    symbol: pair.token1.symbol,
                    decimals: parseInt(pair.token1.decimals),
                    reserve: parseFloat(pair.reserve1),
                },
                volumeUSD: parseFloat(pair.volumeUSD),
            }));
        } else {
            throw new Error('Invalid response structure');
        }
    } catch (error) {
        logger.error(`Error fetching SushiSwap pair data: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchSushiSwapPairData };
