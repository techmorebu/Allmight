require('dotenv').config();
const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const UNISWAP_GRAPHQL_URL = process.env.UNISWAP_GRAPHQL_URL;
const redis = new Redis();

async function fetchTopPools() {
    logger.info('Fetching top pools...');
    const query = `
        query {
            pools(orderBy: totalValueLockedUSD, orderDirection: desc, first: 10) {
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

        for (const pool of pools) {
            const redisKey = `uniswap:pool:${pool.id}`;
            await redis.set(redisKey, JSON.stringify(pool));
            logger.info(`Stored pool data in Redis: ${redisKey}`);
        }

        return pools;
    } catch (error) {
        logger.error(`Error fetching data from Uniswap: ${error.message}`);
        return null;
    }
}

async function fetchHistoricalTokenData(tokenId) {
    logger.info(`Fetching historical data for token: ${tokenId}`);

    const query = `
        query ($tokenId: String!) {
            token(id: $tokenId) {
                id
                tokenDayData(orderBy: date, orderDirection: desc, first: 7) {
                    date
                    priceUSD
                    dailyVolumeUSD
                    totalLiquidityUSD
                }
            }
        }
    `;

    try {
        const response = await axios.post(UNISWAP_GRAPHQL_URL, {
            query,
            variables: { tokenId },
        });

        const token = response.data.data.token;
        if (!token || !token.tokenDayData) {
            logger.error(`No historical data returned for token: ${tokenId}`);
            return null;
        }

        const historicalData = token.tokenDayData.map((data) => ({
            date: data.date,
            priceUSD: data.priceUSD || 'N/A',
            volumeUSD: data.dailyVolumeUSD || 'N/A',
            liquidityUSD: data.totalLiquidityUSD || 'N/A',
        }));

        const redisKey = `uniswap:token:${tokenId}`;
        await redis.set(redisKey, JSON.stringify(historicalData));
        logger.info(`Historical data for token ${tokenId} stored in Redis under key: ${redisKey}`);

        return historicalData;
    } catch (error) {
        logger.error(`Error fetching historical data for token ${tokenId}: ${error.message}`);
        return null;
    }
}

module.exports = { fetchTopPools, fetchHistoricalTokenData };


