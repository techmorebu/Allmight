const axios = require('axios');
const { logger } = require('../monitoring/logger');

const QUICKSWAP_API = 'https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g';

async function fetchQuickSwapData() {
  logger.info('Starting QuickSwap data fetcher...');

  try {
    logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);
    
    const query = `
      {
        pairs(first: 10) {
          id
          token0 {
            symbol
          }
          token1 {
            symbol
          }
          reserveUSD
        }
      }
    `;

    const response = await axios.post(QUICKSWAP_API, { query });

    if (!response.data || !response.data.data) {
      logger.error('Invalid or null response from QuickSwap API.');
      logger.error(`Detailed error: ${JSON.stringify(response.data, null, 2)}`);
      return;
    }

    const pairs = response.data.data.pairs;

    if (!pairs || pairs.length === 0) {
      logger.warn('No pairs found in the API response.');
      return;
    }

    logger.info(`Fetched ${pairs.length} QuickSwap pairs successfully.`);
    logger.info('Sample Pair:', pairs[0]);

    // Logic to store pairs in Redis or process further
  } catch (error) {
    logger.error('Error fetching QuickSwap data:', error.message);
  }
}

fetchQuickSwapData();
