const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const SUSHISWAP_API_URL = process.env.SUSHISWAP_API_URL || 'https://api.thegraph.com/subgraphs/name/sushiswap/arbitrum-one';

/**
 * Fetch pair-level data from SushiSwap subgraph using Axios
 * @param {number} limit - Number of pairs to fetch
 * @param {string} orderBy - Field to sort pairs by
 * @param {string} orderDirection - Sort direction (asc/desc)
 */
async function fetchSushiSwapPairData(limit = 10, orderBy = 'totalValueLockedUSD', orderDirection = 'desc') {
    try {
        const query = `
        query FetchPairs($limit: Int!, $orderBy: String!, $orderDirection: String!) {
            liquidityPools(first: $limit, orderBy: $orderBy, orderDirection: $orderDirection) {
                id
                name
                inputTokens {
                    symbol
                    name
                }
                totalValueLockedUSD
                fees {
                    feeType
                    feePercentage
                }
            }
        }`;

        const response = await axios.post(SUSHISWAP_API_URL, {
            query,
            variables: { limit, orderBy, orderDirection }
        });

        if (response.data && response.data.data && response.data.data.liquidityPools) {
            const parsedData = response.data.data.liquidityPools.map(pool => ({
                id: pool.id,
                name: pool.name,
                tokens: pool.inputTokens.map(token => ({
                    symbol: token.symbol,
                    name: token.name,
                })),
                totalValueLockedUSD: parseFloat(pool.totalValueLockedUSD || 0),
                fees: pool.fees.map(fee => ({
                    type: fee.feeType,
                    percentage: parseFloat(fee.feePercentage || 0),
                })),
            }));

            logger.info('Fetched SushiSwap pair data successfully', { pairCount: parsedData.length });
            console.log('Parsed Pair Data:', JSON.stringify(parsedData, null, 2)); // Expanded logging
            return parsedData;
        } else {
            throw new Error('Invalid response structure');
        }
    } catch (error) {
        logger.error(`Error fetching SushiSwap pair data: ${error.message}`);
        console.error('Error stack:', error.stack); // Log the error stack for debugging
        throw error;
    }
}

module.exports = { fetchSushiSwapPairData };
