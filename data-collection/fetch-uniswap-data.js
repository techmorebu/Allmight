require('dotenv').config();
const Redis = require('ioredis');
const redis = new Redis();
const axios = require('axios');
const { logger } = require('../monitoring/logger');

// Load environment variables
const UNISWAP_GRAPHQL_URL = process.env.UNISWAP_GRAPHQL_URL;

// Fetch top pools from Uniswap
async function fetchTopPools(redis) {
    const query = `
        query {
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
                totalValueLockedUSD
                volumeUSD
            }
        }
    `;

    try {
        const response = await axios.post(UNISWAP_GRAPHQL_URL, { query });
        const pools = response.data.data.pools;

        if (!pools || pools.length === 0) {
            logger.warn('No pools fetched from Uniswap.');
            return;
        }

        for (const pool of pools) {
            const redisKey = `uniswap:pool:${pool.id}`;
            await redis.set(redisKey, JSON.stringify(pool));
            logger.info(`Stored pool data in Redis: ${redisKey}`);
        }

        return pools;
    } catch (error) {
        logger.error(`Error fetching pools: ${error.message}`);
        throw error;
    }
}

// Fetch historical data for a specific token
async function fetchTokenHistoricalData(tokenId, redis) {
    const query = `
        query ($id: String!) {
            token(id: $id) {
                id
                symbol
                tokenDayData(first: 7, orderBy: date, orderDirection: desc) {
                    date
                    priceUSD
                    dailyVolumeUSD
                    totalLiquidityUSD
                }
            }
        }
    `;

    const variables = { id: tokenId };

    try {
        const response = await axios.post(UNISWAP_GRAPHQL_URL, {
            query,
            variables,
        });

        const tokenData = response.data.data?.token;

        if (!tokenData || !tokenData.tokenDayData) {
            logger.warn(`No historical data found for token: ${tokenId}`);
            return;
        }

        const historicalData = tokenData.tokenDayData.map((day) => ({
            date: day.date,
            priceUSD: day.priceUSD,
            dailyVolumeUSD: day.dailyVolumeUSD,
            totalLiquidityUSD: day.totalLiquidityUSD,
        }));

        // Store data in Redis
        const redisKey = `uniswap:token:${tokenId}:historical`;
        await redis.set(redisKey, JSON.stringify(historicalData));
        logger.info(`Stored historical data for token: ${tokenId}`);
    } catch (error) {
        logger.error(`Error fetching historical data for token: ${tokenId}. ${error.message}`);
    }
}

module.exports = {
    fetchTopPools,
    fetchTokenHistoricalData,
};
