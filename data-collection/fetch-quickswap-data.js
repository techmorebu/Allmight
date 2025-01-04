const axios = require('axios');
const { logger } = require('../monitoring/logger');
const redis = require('../utils/redis');

const QUICKSWAP_API_URL = process.env.QUICKSWAP_API;

async function fetchQuickSwapData() {
    try {
        logger.info('Starting QuickSwap data fetcher...');
        logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API_URL}`);
        
        const query = {
            query: `
                {
                    pools(first: 10, orderBy: volumeUSD, orderDirection: desc) {
                        id
                        token0 {
                            id
                            symbol
                            name
                        }
                        token1 {
                            id
                            symbol
                            name
                        }
                        volumeUSD
                        totalValueLockedUSD
                        feesUSD
                        txCount
                    }
                }
            `
        };

        const response = await axios.post(QUICKSWAP_API_URL, query);

        // Check for valid response
        if (!response.data || !response.data.data || !response.data.data.pools) {
            throw new Error('Invalid or null response from QuickSwap API.');
        }

        logger.info('Fetched QuickSwap pool data successfully.');
        logger.info(`Fetched ${response.data.data.pools.length} pools.`);

        const pools = response.data.data.pools;

        // Store in Redis
        await redis.set('quickswap:pools', JSON.stringify(pools));
        logger.info('Stored QuickSwap pool data in Redis.');
    } catch (error) {
        logger.error(`Error fetching QuickSwap data: ${error.message}`);
        logger.error('Detailed error:', error);
    }
}

module.exports = fetchQuickSwapData;

if (require.main === module) {
    fetchQuickSwapData();
}
