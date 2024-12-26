// File: data-collection/fetch-uniswap-data.js
require('dotenv').config(); // Load environment variables
const axios = require('axios');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || undefined);

// Use the Uniswap GraphQL endpoint from .env
const UNISWAP_GRAPHQL_URL = process.env.UNISWAP_GRAPHQL_URL || 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';

// GraphQL query to fetch pools
const POOLS_QUERY = `
{
    pools(first: 10, orderBy: totalValueLockedUSD, orderDirection: desc) {
        id
        token0 {
            symbol
        }
        token1 {
            symbol
        }
        totalValueLockedUSD
    }
}
`;

// Fetch data from Uniswap GraphQL
async function fetchPoolsData() {
    try {
        const response = await axios.post(UNISWAP_GRAPHQL_URL, { query: POOLS_QUERY });
        if (response.data && response.data.data && response.data.data.pools) {
            const pools = response.data.data.pools;
            logger.info(`Fetched ${pools.length} pools from Uniswap.`);
            return pools;
        } else {
            throw new Error('No pools data found in response.');
        }
    } catch (error) {
        logger.error(`Error fetching pools: ${error.message}`);
        throw error;
    }
}

// Cache data in Redis
async function cachePoolsData(pools) {
    try {
        const key = 'uniswap:pools';
        await redis.set(key, JSON.stringify(pools));
        logger.info(`Cached ${pools.length} pools data in Redis.`);
    } catch (error) {
        logger.error(`Error caching pools data: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchPoolsData, cachePoolsData };
