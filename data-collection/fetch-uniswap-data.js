require('dotenv').config();
const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const redis = new Redis();

// Fetch top pools from Uniswap
const fetchTopPools = async () => {
    const query = `
        query TopPools {
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
        const response = await axios.post(process.env.UNISWAP_GRAPHQL_URL, { query });

        if (response.data.errors) {
            logger.error(`GraphQL Errors: ${JSON.stringify(response.data.errors)}`);
            throw new Error('GraphQL query failed');
        }

        return response.data.data.pools || [];
    } catch (error) {
        logger.error(`Error fetching data from Uniswap: ${error.message}`);
        return [];
    }
};

// Fetch historical token data
const fetchHistoricalData = async (tokenId) => {
    const query = `
        query TokenDayData($tokenId: String!) {
            tokenDayDatas(where: { token: $tokenId }, first: 10, orderBy: date, orderDirection: desc) {
                date
                priceUSD
                totalLiquidityToken
                totalLiquidityUSD
                dailyVolumeToken
                dailyVolumeUSD
            }
        }
    `;

    const variables = { tokenId };

    try {
        const response = await axios.post(process.env.UNISWAP_GRAPHQL_URL, {
            query,
            variables,
        });

        if (response.data.errors) {
            logger.error(`GraphQL Errors: ${JSON.stringify(response.data.errors)}`);
            throw new Error('GraphQL query failed');
        }

        return response.data.data.tokenDayDatas || [];
    } catch (error) {
        logger.error(`Error fetching historical data for token ${tokenId}: ${error.message}`);
        return [];
    }
};

// Fetch historical data for tokens
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


// Main workflow
const fetchUniswapData = async () => {
    try {
        logger.info('Fetching top pools from Uniswap...');
        const topPools = await fetchTopPools();

        if (topPools.length === 0) {
            logger.warn('No pools fetched. Exiting...');
            return;
        }

        // Store pool data in Redis
        for (const pool of topPools) {
            await redis.set(`uniswap:pool:${pool.id}`, JSON.stringify(pool));
            logger.info(`Stored pool data in Redis: uniswap:pool:${pool.id}`);
        }

        // Collect unique tokens from pools
        const tokens = new Set();
        for (const pool of topPools) {
            tokens.add(pool.token0);
            tokens.add(pool.token1);
        }

        logger.info('Fetching historical data for tokens...');
        await fetchTokenHistoricalData([...tokens]);
    } catch (error) {
        logger.error(`Error in Uniswap fetcher: ${error.message}`);
    } finally {
        redis.disconnect();
        logger.info('Redis connection closed.');
    }
};

// Execute fetcher
fetchUniswapData();



