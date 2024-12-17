require('dotenv').config();
const axios = require('axios');
const { logger } = require('../monitoring/logger');

async function fetchTokenPrices(tokenIds = ['ethereum', 'zksync'], vsCurrencies = 'usd') {
    const url = 'https://api.coingecko.com/api/v3/simple/price';
    const params = {
        ids: tokenIds.join(','),
        vs_currencies: vsCurrencies,
        include_market_cap: true,
        include_24hr_vol: true,
        include_24hr_change: true,
    };

    try {
        logger.info('Fetching token prices from CoinGecko...');
        const response = await axios.get(url, { params });
        return response.data;
    } catch (error) {
        logger.error(`Error fetching token prices: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchTokenPrices };
