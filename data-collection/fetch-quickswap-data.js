const axios = require('axios');
const { logger } = require('../monitoring/logger'); // Adjust path as needed
require('dotenv').config();

const QUICKSWAP_API = process.env.QUICKSWAP_API;

async function fetchQuickSwapData() {
  logger.info('Fetching QuickSwap data...');
  try {
    const response = await axios.post(QUICKSWAP_API, {
      query: `
        {
          pools(first: 10, orderBy: liquidity, orderDirection: desc) {
            id
            token0 {
              id
              symbol
              decimals
            }
            token1 {
              id
              symbol
              decimals
            }
            liquidity
            volumeUSD
            feesUSD
          }
          tokens(first: 10, orderBy: volumeUSD, orderDirection: desc) {
            id
            symbol
            name
            volumeUSD
            derivedETH
          }
        }
      `,
    });

    const { pools, tokens } = response.data.data;

    if (!pools || !tokens) {
      throw new Error('No data returned from QuickSwap API');
    }

    logger.info(`Fetched ${pools.length} pools and ${tokens.length} tokens.`);
    
    // Save data to Redis or process further
    // Example:
    for (const pool of pools) {
      logger.info(`Pool ID: ${pool.id} | Liquidity: ${pool.liquidity}`);
    }
    for (const token of tokens) {
      logger.info(`Token: ${token.symbol} | Volume USD: ${token.volumeUSD}`);
    }

    logger.info('QuickSwap data fetching completed successfully.');
  } catch (error) {
    logger.error(`Error fetching QuickSwap data: ${error.message}`);
  }
}

fetchQuickSwapData();
