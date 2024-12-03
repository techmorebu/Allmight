require('dotenv').config();
const axios = require('axios');
const { logger } = require('../monitoring/logger');

// Fetch token prices using CoinGecko API
async function fetchTokenPrices() {
  const url = 'https://api.coingecko.com/api/v3/simple/price';
  const params = {
    ids: 'ethereum,zksync', // Add more tokens as needed
    vs_currencies: 'usd',
    include_market_cap: true,
    include_24hr_vol: true,
    include_24hr_change: true,
    include_last_updated_at: true,
  };

  try {
    logger.info('Fetching token prices from CoinGecko...');
    const response = await axios.get(url, { params });
    logger.info('Fetched token prices successfully.');
    return response.data;
  } catch (error) {
    logger.error(`Error fetching token prices: ${error.message}`);
    throw error;
  }
}

module.exports = { fetchTokenPrices };
