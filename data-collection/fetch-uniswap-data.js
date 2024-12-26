require('dotenv').config();
const axios = require('axios');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

const redis = new Redis();
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
            }
        }`;

        const response = await axios.post(UNISWAP_GRAPHQL_URL, { query });
        const pools = response.data.data.pools;

        if (pools) {
            logger.info(`Fetched ${pools.length} pools successfully.`);
            return pools;
        } else {
            throw new Error('No pools found.');
        }
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
            }
        }`;

        const response = await axios.post(UNISWAP_GRAPHQL_URL, { query });
        const historicalData = response.data.data.tokenDayDatas;

        if (historicalData) {
            logger.info(`Fetched historical data for token: ${tokenId}`);
            return historicalData;
        } else {
            throw new Error(`No historical data found for token: ${tokenId}`);
        }
    } catch (error) {
        logger.error(`Error fetching historical data for token: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchTopPools, fetchHistoricalDataForToken };
