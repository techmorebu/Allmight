const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const redis = new Redis();

// The Graph endpoint for Uniswap
const GRAPH_API_URL = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';

async function fetchPools() {
    try {
        const query = `
        {
            pools(first: 10, orderBy: totalValueLockedUSD, orderDirection: desc) {
                id
                token0 {
                    id
                    symbol
                }
                token1 {
                    id
                    symbol
                }
                feeTier
                liquidity
                volumeUSD
                totalValueLockedUSD
            }
        }
        `;
        const response = await axios.post(GRAPH_API_URL, { query });
        const pools = response.data.data.pools;

        logger.info(`Fetched ${pools.length} pools.`);
        return pools;
    } catch (error) {
        logger.error(`Error fetching pools: ${error.message}`);
        throw error;
    }
}

async function storePoolsInRedis(pools) {
    try {
        for (const pool of pools) {
            const redisKey = `uniswap:pool:${pool.id}`;
            await redis.set(redisKey, JSON.stringify(pool));
            logger.info(`Stored pool data for ${pool.token0.symbol}/${pool.token1.symbol} in Redis.`);
        }
    } catch (error) {
        logger.error(`Error storing pools in Redis: ${error.message}`);
    }
}

async function fetchAndStorePools() {
    try {
        const pools = await fetchPools();
        await storePoolsInRedis(pools);
    } catch (error) {
        logger.error(`Workflow error: ${error.message}`);
    } finally {
        redis.disconnect();
    }
}

module.exports = { fetchPools, storePoolsInRedis, fetchAndStorePools };
