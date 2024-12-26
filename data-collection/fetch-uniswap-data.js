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

async function fetchHistoricalDataForToken(tokenId) {
    try {
        const query = `
        {
            tokenDayDatas(where: { token: "${tokenId}" }, first: 7, orderBy: date, orderDirection: desc) {
                date
                priceUSD
                totalLiquidityUSD
                volumeUSD
            }
        }`;

        const response = await axios.post(UNISWAP_GRAPHQL_URL, { query });

        if (response.data.errors) {
            logger.error(`GraphQL Errors: ${JSON.stringify(response.data.errors)}`);
            throw new Error('GraphQL query failed');
        }

        const historicalData = response.data.data.tokenDayDatas;
        if (!historicalData || historicalData.length === 0) {
            logger.warn(`No historical data found for token: ${tokenId}`);
            return [];
        }

        logger.info(`Fetched historical data for token: ${tokenId}`);
        return historicalData;
    } catch (error) {
        logger.error(`Error fetching historical data for token: ${tokenId}. ${error.message}`);
        throw error;
    }
}

module.exports = { fetchTopPools, fetchHistoricalDataForToken };

