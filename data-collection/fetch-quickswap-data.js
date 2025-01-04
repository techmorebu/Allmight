const axios = require("axios");
const { logger } = require('../monitoring/logger');

// Define the QuickSwap API endpoint
const API_URL = "https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g";

// GraphQL query to fetch pools data
const QUERY = `
  {
    pools(first: 10) {
      id
      token0 {
        id
        symbol
        name
      }
      token1 {
        id
        symbol
        name
      }
      volumeUSD
      liquidity
    }
  }
`;

async function fetchQuickSwapData() {
  logger.info("Starting QuickSwap data fetcher...");
  logger.info(`Fetching data from QuickSwap API at: ${API_URL}`);

  try {
    const response = await axios.post(
      API_URL,
      { query: QUERY },
      { headers: { "Content-Type": "application/json" } }
    );

    // Handle null or invalid responses
    if (!response.data || !response.data.data || !response.data.data.pools) {
      throw new Error("Invalid or null response from QuickSwap API.");
    }

    const pools = response.data.data.pools;
    logger.info("QuickSwap data fetched successfully.");
    logger.info(`Fetched ${pools.length} pools from QuickSwap.`);
    logger.info("Sample pool data:", pools[0]);

    return pools;
  } catch (error) {
    logger.error("Error fetching QuickSwap data:", error.message);
    logger.error("Detailed error:", error);
    throw error;
  }
}

// Export the function for use in other modules
module.exports = {
  fetchQuickSwapData,
};
