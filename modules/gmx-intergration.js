require('dotenv').config({ path: '../.env' });
const axios = require('axios');
const { logger, logAndNotify } = require('../monitoring/logger');

// GMX API Configuration
const GMX_CONFIG = {
  ARBITRUM: {
    TOKENS_URL: process.env.GMX_ARBITRUM_TOKENS_URL,
    PRICES_URL: process.env.GMX_ARBITRUM_PRICES_URL,
    PAIRS_URL: process.env.GMX_ARBITRUM_PAIRS_URL,
    CANDLES_URL: process.env.GMX_ARBITRUM_CANDLES_URL,
  },
  AVALANCHE: {
    TOKENS_URL: process.env.GMX_AVALANCHE_TOKENS_URL,
    PRICES_URL: process.env.GMX_AVALANCHE_PRICES_URL,
    PAIRS_URL: process.env.GMX_AVALANCHE_PAIRS_URL,
    CANDLES_URL: process.env.GMX_AVALANCHE_CANDLES_URL,
  },
  RATE_LIMIT: parseInt(process.env.GMX_API_RATE_LIMIT, 10) || 5,
  TIMEOUT: parseInt(process.env.GMX_API_TIMEOUT, 10) || 3000,
};

/**
 * Fetch data from a specified GMX API endpoint.
 * @param {string} url - The GMX API endpoint URL.
 * @param {string} description - Description of the data being fetched.
 * @param {Object} [params={}] - Query parameters for the request.
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
    logger.info(`Fetched ${description}:`, response.data);
    return response.data;
  } catch (error) {
    logAndNotify('error', `Error fetching ${description}: ${error.message}`);
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
 * Fetch candle data from GMX.
 * @param {string} network - The network to fetch data from ('ARBITRUM' or 'AVALANCHE').
 * @param {Object} options - Query options for candles (e.g., market, resolution, from, to).
 * @returns {Promise<Object|null>} - Candle data or null if an error occurs.
 */
async function fetchCandles(network = 'ARBITRUM', options = {}) {
  const url = GMX_CONFIG[network]?.CANDLES_URL;
  const { market = 'ETH_USD', resolution = '1h', from, to } = options;

  if (!url) {
    logger.error(`Candles URL is missing for ${network}`);
    return null;
  }

  if (!from || !to) {
    logger.error(`Missing 'from' or 'to' timestamp for fetching candles (${network}).`);
    return null;
  }

  const params = {
    market,
    resolution,
    from,
    to,
  };

  return fetchGMXData(url, `candles for ${network} (${market})`, params);
}

/**
 * Main GMX Integration Function.
 * Fetches token, price, pair, and candle data for both Arbitrum and Avalanche networks.
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

      const now = Math.floor(Date.now() / 1000);
      const oneDayAgo = now - 86400; // Last 24 hours
      const candles = await fetchCandles(network, {
        market: 'ETH_USD',
        resolution: '1h',
        from: oneDayAgo,
        to: now,
      });

      if (tokens && prices && pairs && candles) {
        logger.info(`GMX Integration Successful (${network})`);
        logger.info(`Tokens: ${JSON.stringify(tokens, null, 2)}`);
        logger.info(`Prices: ${JSON.stringify(prices, null, 2)}`);
        logger.info(`Pairs: ${JSON.stringify(pairs, null, 2)}`);
        logger.info(`Candles: ${JSON.stringify(candles, null, 2)}`);
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
