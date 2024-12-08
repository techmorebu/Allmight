const axios = require('axios');
const fs = require('fs');
const { logger } = require('../monitoring/logger');

require('dotenv').config({ path: '/home/techbu/OFA_Project_Local/ofa-project/.env' });

const UNISWAP_SUBGRAPH_URL = process.env.UNISWAP_SUBGRAPH_URL;

async function fetchUniswapData() {
    try {
        if (!UNISWAP_SUBGRAPH_URL) {
            throw new Error('Uniswap Subgraph URL is not set or invalid.');
        }

        logger.info(`Fetching Uniswap data from: ${UNISWAP_SUBGRAPH_URL}`);

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
        const data = response.data;

        if (!data || !data.data || !data.data.pools) {
            throw new Error('Invalid or empty response from Uniswap Subgraph.');
        }

        logger.info(`Uniswap API returned ${data.data.pools.length} pools. Validating data...`);

        const pools = data.data.pools.map((pool) => {
            if (
                pool &&
                pool.token0 &&
                pool.token1 &&
                pool.volumeUSD &&
                pool.liquidity
            ) {
                return {
                    id: pool.id,
                    pair: `${pool.token0.symbol}/${pool.token1.symbol}`,
                    volumeUSD: parseFloat(pool.volumeUSD),
                    liquidity: parseFloat(pool.liquidity),
                };
            } else {
                logger.warn(`Skipping invalid pool data: ${JSON.stringify(pool)}`);
                return null;
            }
        }).filter(Boolean);

        logger.info(`${pools.length} valid pools processed from Uniswap.`);
        return pools;
    } catch (error) {
        logger.error(`Error fetching Uniswap data: ${error.message}`);
        return null;
    }
}

module.exports = { fetchUniswapData };
