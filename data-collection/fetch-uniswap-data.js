require('dotenv').config();
const axios = require('axios');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

const UNISWAP_GRAPHQL_URL = process.env.UNISWAP_GRAPHQL_URL;

const redis = new Redis();

async function fetchGraphQLData(query, variables = {}) {
    try {
        const response = await axios.post(UNISWAP_GRAPHQL_URL, { query, variables });
        if (response.data.errors) {
            logger.error(`GraphQL Errors: ${JSON.stringify(response.data.errors)}`);
            throw new Error('GraphQL query failed');
        }
        return response.data.data;
    } catch (error) {
        logger.error(`Error fetching data from Uniswap: ${error.message}`);
        throw error;
    }
}

async function fetchTopPools() {
    const query = `
        {
            pools(
                first: 10,
                orderBy: totalValueLockedUSD,
                orderDirection: desc
            ) {
                id
                token0 {
                    symbol
                }
                token1 {
                    symbol
                }
                totalValueLockedUSD
                volumeUSD
            }
        }
    `;
    const data = await fetchGraphQLData(query);
    return data.pools;
}

async function fetchTokenDayData(tokenId) {
    const query = `
        {
            tokenDayDatas(
                first: 7,
                orderBy: date,
                orderDirection: desc,
                where: { token: "${tokenId}" }
            ) {
                date
                dailyVolumeUSD
                priceUSD
            }
        }
    `;
    const data = await fetchGraphQLData(query);
    return data.tokenDayDatas;
}

module.exports = { fetchTopPools, fetchTokenDayData };
