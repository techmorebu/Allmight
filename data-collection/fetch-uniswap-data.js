require('dotenv').config();
const Redis = require('ioredis');
const axios = require('axios');
const { logger } = require('../monitoring/logger');

const UNISWAP_GRAPHQL_URL = process.env.UNISWAP_GRAPHQL_URL;

async function fetchTopPools() {
    try {
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
        const response = await axios.post(UNISWAP_GRAPHQL_URL, { query });
        if (response.data.errors) {
            logger.error(`GraphQL Errors: ${JSON.stringify(response.data.errors)}`);
            throw new Error('GraphQL query failed');
        }
        return response.data.data.pools;
    } catch (error) {
        logger.error(`Error fetching top pools: ${error.message}`);
        throw error;
    }
}

async function fetchTokenHistoricalData(tokenId) {
    try {
        const query = `
            query ($id: String!) {
                token(id: $id) {
                    tokenDayData(first: 7, orderBy: date, orderDirection: desc) {
                        date
                        priceUSD
                        volumeUSD
                        totalLiquidityUSD
                    }
                }
            }
        `;

        const variables = { id: tokenId };
        const response = await axios.post(UNISWAP_GRAPHQL_URL, { query, variables });

        if (response.data.errors) {
            logger.error(`GraphQL Errors: ${JSON.stringify(response.data.errors)}`);
            throw new Error('GraphQL query failed');
        }

        const tokenData = response.data.data.token;
        if (!tokenData || !tokenData.tokenDayData || tokenData.tokenDayData.length === 0) {
            logger.warn(`No historical data found for token: ${tokenId}`);
            return null;
        }

        logger.info(`Fetched historical data for token: ${tokenId}`);
        return tokenData.tokenDayData;
    } catch (error) {
        logger.error(`Error fetching historical data for token: ${tokenId}. ${error.message}`);
        return null;
    }
}

module.exports = {
    fetchTopPools,
    fetchTokenHistoricalData,
};
