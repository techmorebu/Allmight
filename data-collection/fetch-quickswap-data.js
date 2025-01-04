const axios = require('axios');
const { logger } = require('../monitoring/logger');

const QUICKSWAP_API = "https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/CCFSaj7uS128wazXMdxdnbGA3YQnND9yBdHjPtvH7Bc7";

async function fetchQuickSwapData() {
  logger.info("Starting QuickSwap data fetcher...");
  logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);

  try {
    const response = await axios.post(QUICKSWAP_API, {
      query: `
        {
          pools(first: 10, orderBy: volumeUSD, orderDirection: desc) {
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
            fees
          }
        }
      `,
    });

    if (!response.data || response.data.errors) {
      logger.error("Invalid or null response from QuickSwap API.");
      logger.error("Detailed error:", response.data.errors);
      return;
    }

    const pools = response.data.data.pools;
    logger.info(`Fetched ${pools.length} QuickSwap pools successfully.`);
    // Store pools in Redis or perform further operations
  } catch (error) {
    logger.error("Error fetching QuickSwap data:", error.message);
  }
}

fetchQuickSwapData();
