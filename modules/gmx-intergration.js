require('dotenv').config({ path: '../.env' });
const axios = require('axios');
const { logger, logAndNotify } = require('../monitoring/logger');

// GMX API Configuration
const GMX_CONFIG = {
  ARBITRUM: {
    TOKENS_URL: process.env.GMX_ARBITRUM_TOKENS_URL,
    PRICES_URL: process.env.GMX_ARBITRUM_PRICES_URL,
    CANDLES_URL: process.env.GMX_ARBITRUM_CANDLES_URL,
    PAIRS_URL: process.env.GMX_ARBITRUM_PAIRS_URL,
  },
  AVALANCHE: {
    TOKENS_URL: process.env.GMX_AVALANCHE_TOKENS_URL,
    PRICES_URL: process.env.GMX_AVALANCHE_PRICES_URL,
    CANDLES_URL: process.env.GMX_AVALANCHE_CANDLES_URL,
    PAIRS_URL: process.env.GMX_AVALANCHE_PAIRS_URL,
  },
  RATE_LIMIT: parseInt(process.env.GMX_API_RATE_LIMIT, 10) || 5,
  TIMEOUT: parseInt(process.env.GMX_API_TIMEOUT, 10) || 3000,
};

/**
 * Fetch data from a specified GMX API endpoint.
 * @param {string} url - The GMX API endpoint URL.
 * @param {string} description - Description of the data being fetched.
 * @param {Object} params - Query parameters for the request.
 * @returns {Promise<Object|null>} - Fetched data or null if an error occurs.
 */
async function fetchGMXData(url, description, params = {}) {
  if (!url) {
    logger.error(`${description} URL is missing in the configuration.`);
    return null;
  }

  try {
    logger.info(`Fetching ${description}...`);
    const response = await axios.get(url, { params, timeout: GMX_CONFIG.TIMEOUT });
    logger.info(`Fetched ${description}: ${JSON.stringify(response.data, null, 2)}`);
    return response.data;
  } catch (error) {
    logAndNotify('error', `Error fetching ${description}: ${error.message}`);
    if (error.response) {
      logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

/**
 * Fetch token data from GMX.
 * @param {string} network - The network to fetch data from ('ARBITRUM' or 'AVALANCHE').
 * @returns {Promise<Object|null>} - Token data or null if an error occurs.
 */
async function fetchTokens(network = 'ARBITRUM') {
  return fetchGMXData(GMX_CONFIG[network]?.TOKENS_URL, `tokens for ${network}`);
}

/**
 * Fetch price data from GMX.
 * @param {string} network - The network to fetch data from ('ARBITRUM' or 'AVALANCHE').
 * @returns {Promise<Object|null>} - Price data or null if an error occurs.
 */
async function fetchPrices(network = 'ARBITRUM') {
  return fetchGMXData(GMX_CONFIG[network]?.PRICES_URL, `prices for ${network}`);
}

/**
 * Fetch pair data from GMX.
 * @param {string} network - The network to fetch data from ('ARBITRUM' or 'AVALANCHE').
 * @returns {Promise<Object|null>} - Pair data or null if an error occurs.
 */
async function fetchPairs(network = 'ARBITRUM') {
  return fetchGMXData(GMX_CONFIG[network]?.PAIRS_URL, `pairs for ${network}`);
}

/**
 * Fetch candlestick data from GMX.
 * @param {string} network - The network to fetch data from ('ARBITRUM' or 'AVALANCHE').
 * @param {string} tokenSymbol - The token symbol (e.g., 'ETH', 'AVAX').
 * @param {string} period - The period for candlestick data (e.g., '1m', '1h', '1d').
 * @returns {Promise<Object|null>} - Candlestick data or null if an error occurs.
 */
async function fetchCandles(network = 'ARBITRUM', tokenSymbol, period = '1h') {
  const url = GMX_CONFIG[network]?.CANDLES_URL;
  if (!url) {
    logger.error(`Candles URL for ${network} is missing.`);
    return null;
  }

  const params = { tokenSymbol, period };
  try {
    logger.info(`Fetching candles for ${network} (${tokenSymbol}) with URL: ${url}`);
    logger.info(`Request parameters: ${JSON.stringify(params)}`);
    const response = await axios.get(url, { params, timeout: GMX_CONFIG.TIMEOUT });
    logger.info(`Fetched candles: ${JSON.stringify(response.data, null, 2)}`);
    return response.data;
  } catch (error) {
    logger.error(`Error fetching candles for ${network} (${tokenSymbol}): ${error.message}`);
    if (error.response) {
      logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

/**
 * Main GMX Integration Function.
 * Fetches token, price, and pair data for both Arbitrum and Avalanche networks.
 */
async function gmxIntegration() {
  try {
    logger.info('--- Starting GMX Integration ---');

    const networks = ['ARBITRUM', 'AVALANCHE'];
    for (const network of networks) {
      logger.info(`Fetching GMX data for ${network} network...`);

      const tokens = await fetchTokens(network);
      const prices = await fetchPrices(network);
      const pairs = await fetchPairs(network);

      const candlesETH = await fetchCandles(network, 'ETH', '1h');
      const candlesAVAX = await fetchCandles(network, 'AVAX', '1h');

      if (tokens && prices && pairs) {
        logger.info(`GMX Integration Successful (${network})`);
        logger.info(`Tokens: ${JSON.stringify(tokens, null, 2)}`);
        logger.info(`Prices: ${JSON.stringify(prices, null, 2)}`);
        logger.info(`Pairs: ${JSON.stringify(pairs, null, 2)}`);
        logger.info(`Candles ETH: ${JSON.stringify(candlesETH, null, 2)}`);
        logger.info(`Candles AVAX: ${JSON.stringify(candlesAVAX, null, 2)}`);
      } else {
        logger.warn(`Some data is missing for ${network}.`);
      }
    }

    logger.info('--- GMX Integration Completed ---');
  } catch (error) {
    logAndNotify('error', `Error during GMX integration: ${error.message}`);
  }
}

// Export functions for reuse in the project
module.exports = { fetchTokens, fetchPrices, fetchPairs, fetchCandles, gmxIntegration };

// Run the GMX Integration if executed directly
if (require.main === module) {
  gmxIntegration();
}
