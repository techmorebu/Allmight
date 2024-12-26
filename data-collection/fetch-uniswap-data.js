require('dotenv').config();
const axios = require('axios');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

const UNISWAP_GRAPHQL_URL = process.env.UNISWAP_GRAPHQL_URL;

async function fetchTopPools() {
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
                totalValueLockedUSD
                volumeUSD
            }
        }`;

        const response = await axios.post(UNISWAP_GRAPHQL_URL, { query });

        if (response.data.errors) {
            logger.error(`GraphQL Errors: ${JSON.stringify(response.data.errors)}`);
            throw new Error('GraphQL query failed');
        }

        logger.info(`Fetched top pools: ${JSON.stringify(response.data.data.pools)}`);
        return response.data.data.pools;
    } catch (error) {
        logger.error(`Error fetching data from Uniswap: ${error.message}`);
        throw error;
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
            logger.error(
                `No historical data returned for token: ${tokenId}. Ensure GraphQL query structure matches Uniswap schema.`
            );
            return null;
        }

        // Log raw fetched data
        logger.debug(
            `Raw historical data for token ${tokenId}: ${JSON.stringify(token.tokenDayData)}`
        );

        const historicalData = token.tokenDayData.map((data) => ({
            date: data.date,
            priceUSD: data.priceUSD || 'N/A',
            volumeUSD: data.dailyVolumeUSD || 'N/A',
            liquidityUSD: data.totalLiquidityUSD || 'N/A',
        }));

        // Store in Redis
        const redisKey = `uniswap:token:${tokenId}`;
        await redis.set(redisKey, JSON.stringify(historicalData));
        logger.info(`Historical data for token ${tokenId} stored in Redis under key: ${redisKey}`);

        return historicalData;
    } catch (error) {
        logger.error(
            `Error fetching historical data for token ${tokenId}: ${error.message}`
        );
        return null;
    }
}


module.exports = { fetchTopPools, fetchHistoricalDataForToken };

