const { gql, GraphQLClient } = require('graphql-request');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const SUSHISWAP_API_URL = process.env.SUSHISWAP_API_URL || 'https://api.thegraph.com/subgraphs/name/sushiswap/arbitrum-one';

// GraphQL queries
const PAIR_QUERY = gql`
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

const SWAP_QUERY = gql`
query FetchRecentSwaps($limit: Int!) {
  swaps(first: $limit, orderBy: timestamp, orderDirection: desc) {
    id
    transaction {
      id
    }
    pair {
      token0 {
        symbol
      }
      token1 {
        symbol
      }
    }
    amountUSD
    timestamp
  }
}`;

/**
 * Fetch pair-level data from SushiSwap subgraph
 * @param {number} limit - Number of pairs to fetch
 * @param {string} orderBy - Field to sort pairs by
 * @param {string} orderDirection - Sort direction (asc/desc)
 */
async function fetchSushiSwapPairData(limit = 10, orderBy = 'totalValueLockedUSD', orderDirection = 'desc') {
    try {
        const client = new GraphQLClient(SUSHISWAP_API_URL);
        const variables = { limit, orderBy, orderDirection };
        
        const response = await client.request(PAIR_QUERY, variables);

        if (!response.liquidityPools) {
            throw new Error('Invalid response structure');
        }

        return response.liquidityPools.map(pool => ({
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
    } catch (error) {
        logger.error(`Error fetching SushiSwap pair data: ${error.message}`);
        throw error;
    }
}

/**
 * Fetch recent swaps from SushiSwap subgraph
 * @param {number} limit - Number of swaps to fetch
 */
async function fetchSushiSwapRecentSwaps(limit = 10) {
    try {
        const client = new GraphQLClient(SUSHISWAP_API_URL);
        const variables = { limit };

        const response = await client.request(SWAP_QUERY, variables);

        if (!response.swaps) {
            throw new Error('Invalid response structure');
        }

        return response.swaps.map(swap => ({
            id: swap.id,
            transactionId: swap.transaction.id,
            pair: `${swap.pair.token0.symbol}/${swap.pair.token1.symbol}`,
            amountUSD: parseFloat(swap.amountUSD || 0),
            timestamp: new Date(swap.timestamp * 1000),
        }));
    } catch (error) {
        logger.error(`Error fetching SushiSwap swaps: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchSushiSwapPairData, fetchSushiSwapRecentSwaps };
