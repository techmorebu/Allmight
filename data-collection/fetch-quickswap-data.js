const axios = require('axios');
const { logger } = require('../monitoring/logger');
const redis = require('../db/redis');

const QUICKSWAP_API = process.env.QUICKSWAP_API || 'https://gateway.thegraph.com/api/.../subgraphs/id/...';

async function fetchQuickSwapData() {
    logger.info('Starting QuickSwap data fetcher...');

    try {
        logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);

        // Define the GraphQL query
        const query = `
        {
            pools(first: 100, orderBy: totalValueLockedUSD, orderDirection: desc) {
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
                reserveUSD
                volumeUSD
            }
        }
        `;

        // Fetch data from the API
        const response = await axios.post(QUICKSWAP_API, { query });

        if (!response.data || !response.data.data || !response.data.data.pools) {
            logger.error('Invalid or null response from QuickSwap API.');
            throw new Error('Invalid or null response from QuickSwap API.');
        }

        const pools = response.data.data.pools;
        logger.info(`Fetched ${pools.length} pools from QuickSwap.`);

        // Store data in Redis
        const redisKey = 'quickswap:pools';
        await redis.set(redisKey, JSON.stringify(pools));
        logger.info(`Stored ${pools.length} pools in Redis under key: ${redisKey}`);

        return pools;
    } catch (error) {
        logger.error(`Error fetching QuickSwap data: ${error.message}`);
        throw error;
    }
}

// Run the fetcher if executed directly
if (require.main === module) {
    fetchQuickSwapData()
        .then(() => logger.info('QuickSwap data fetcher completed successfully.'))
        .catch(err => logger.error(`QuickSwap data fetcher encountered an error: ${err.message}`));
}

module.exports = { fetchQuickSwapData };
