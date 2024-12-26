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
const fetchTokenHistoricalData = async (tokens) => {
    for (const token of tokens) {
        logger.info(`Fetching historical data for token: ${token.id}`);
        const historicalData = await fetchHistoricalData(token.id);

        if (historicalData.length > 0) {
            await redis.set(`uniswap:token:${token.id}:historical`, JSON.stringify(historicalData));
            logger.info(`Stored historical data for token: ${token.id}`);
        } else {
            logger.warn(`No historical data found for token: ${token.id}`);
        }
    }
};

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



