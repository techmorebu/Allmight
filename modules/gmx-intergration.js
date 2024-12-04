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
 * Fetch candle data from GMX.
 * @param {string} network - The network to fetch data from ('ARBITRUM' or 'AVALANCHE').
 * @param {string} market - The market ticker (e.g., 'ETH_USD').
 * @param {string} resolution - The candle resolution (e.g., '1h', '4h').
 * @param {number} from - Unix timestamp (seconds) for start of the range.
 * @param {number} to - Unix timestamp (seconds) for end of the range.
 * @returns {Promise<Object|null>} - Candle data or null if an error occurs.
 */
async function fetchCandles(network = 'ARBITRUM', market, resolution = '1h', from, to) {
  const url = GMX_CONFIG[network]?.CANDLES_URL;

  if (!url) {
    logger.error(`Candle data URL is missing in the configuration for ${network}.`);
    return null;
  }

  const params = {
    market,
    resolution,
    from: Math.floor(from), // Ensure timestamps are in seconds
    to: Math.floor(to),
  };

  try {
    logger.info(`Fetching candles for ${network} (${market}) with params: ${JSON.stringify(params)}`);
    const response = await axios.get(url, { params, timeout: GMX_CONFIG.TIMEOUT });
    logger.info(`Fetched candles for ${network} (${market}): ${JSON.stringify(response.data)}`);
    return response.data;
  } catch (error) {
    logger.error(
      `Error fetching candles for ${network} (${market}): ${error.response?.data?.message || error.message}`
    );
    return null;
  }
}

/**
 * Example function to test fetchCandles
 */
async function testFetchCandles() {
  const now = Math.floor(Date.now() / 1000);
  const oneDayAgo = now - 24 * 3600;

  const candles = await fetchCandles('ARBITRUM', 'ETH_USD', '1h', oneDayAgo, now);
  if (candles) {
    console.log('Candles fetched:', candles);
  } else {
    console.log('Failed to fetch candles.');
  }
}

// Export the function
module.exports = { fetchCandles };

// Run the test function if executed directly
if (require.main === module) {
  testFetchCandles();
}
