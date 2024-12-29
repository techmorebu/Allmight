require('dotenv').config();
const Redis = require('ioredis');
const axios = require('axios');
const { logger } = require('../monitoring/logger');

const UNISWAP_GRAPHQL_URL = process.env.UNISWAP_GRAPHQL_URL;

// Fetch historical data for a token
async function fetchTokenHistoricalData(tokenId) {
    try {
        const query = `
            query ($id: String!) {
                token(id: $id) {
                    tokenDayData(first: 7, orderBy: date, orderDirection: desc) {
                        date
                        priceUSD
                        dailyVolumeUSD
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
    fetchTokenHistoricalData,
};
