require('dotenv').config();
const axios = require('axios');
const { logger } = require('../monitoring/logger');

async function fetchTokenPrices() {
    const url = 'https://api.coingecko.com/api/v3/simple/price';
    const params = {
        ids: 'ethereum,zksync',
        vs_currencies: 'usd',
        include_market_cap: true,
        include_24hr_vol: true,
        include_24hr_change: true,
    };

    try {
        logger.info('Fetching token prices from CoinGecko...');
        const response = await axios.get(url, { params });
        logger.info('Token prices fetched successfully:', JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (error) {
        logger.error(`Error fetching token prices: ${error.message}`);
        return null;
    }
}

module.exports = { fetchTokenPrices };
