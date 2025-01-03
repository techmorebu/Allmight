const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const SUSHISWAP_API_URL = process.env.SUSHISWAP_API_URL;

if (!SUSHISWAP_API_URL) {
    logger.error('SUSHISWAP_API_URL is not defined in the environment variables');
    process.exit(1); // Exit if the URL is missing
}

logger.info(`Using SushiSwap API URL: ${SUSHISWAP_API_URL}`);

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

        const response = await axios.post(SUSHISWAP_API_URL, { query });

        // Validate the response structure
        if (response.data && response.data.data && response.data.data.liquidityPools) {
            const liquidityPools = response.data.data.liquidityPools.map(pool => ({
                id: pool.id,
                name: pool.name,
                tokens: pool.inputTokens.map(token => ({
                    symbol: token.symbol,
                    decimals: parseInt(token.decimals, 10),
                })),
                totalValueLockedUSD: parseFloat(pool.totalValueLockedUSD),
            }));

            logger.info('Fetched SushiSwap pair data successfully.');
            return liquidityPools;
        } else {
            throw new Error('Invalid response structure or missing liquidityPools data');
        }
    } catch (error) {
        logger.error(`Error fetching SushiSwap pair data: ${error.message}`);
        throw error;
    }
}

(async () => {
    try {
        const data = await fetchSushiSwapPairData();
        logger.info(`Fetched ${data.length} SushiSwap liquidity pools.`);
    } catch (error) {
        logger.error(`Fetcher script failed: ${error.message}`);
    }
})();

module.exports = { fetchSushiSwapPairData };
