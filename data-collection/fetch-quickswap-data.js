const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const QUICKSWAP_API = process.env.QUICKSWAP_API;

const fetchQuickSwapData = async () => {
  logger.info('Starting QuickSwap data fetcher...');

  try {
    const query = `
      {
        pools(first: 10, orderBy: volumeUSD, orderDirection: desc) {
          id
          token0 {
            id
            symbol
          }
          token1 {
            id
            symbol
          }
          reserve0
          reserve1
          totalSupply
          volumeUSD
          feesUSD
        }
      }
    `;

    logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);
    const response = await axios.post(QUICKSWAP_API, { query });

    if (!response.data || !response.data.data || !response.data.data.pools) {
      logger.error('Invalid or null response from QuickSwap API.');
      logger.error(`Detailed error: ${JSON.stringify(response.data)}`);
      return;
    }

    const pools = response.data.data.pools;
    logger.info(`Fetched ${pools.length} QuickSwap pools successfully.`);

    pools.forEach((pool, index) => {
      logger.info(
        `Pool ${index + 1}: ${pool.token0.symbol}/${pool.token1.symbol} - Volume: ${pool.volumeUSD}`
      );
    });

    // TODO: Add logic to store data in Redis or another storage layer
  } catch (error) {
    logger.error(`Error fetching QuickSwap data: ${error.message}`);
    logger.error(`Detailed error: ${error.stack}`);
  }
};

// Execute the fetcher
fetchQuickSwapData();
