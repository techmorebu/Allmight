require("dotenv").config();
const axios = require("axios");
const { logger } = require("../monitoring/logger");

// Fetch token prices using CoinGecko API
async function fetchTokenPrices() {
    const url = 'https://api.coingecko.com/api/v3/simple/price';
    const params = {
        ids: 'ethereum,polygon,zksync',
        vs_currencies: 'usd',
        include_market_cap: true,
        include_24hr_vol: true,
        include_24hr_change: true,
        include_last_updated_at: true,
        precision: 'full'
    };

    const headers = {
        accept: 'application/json',
        'x-cg-demo-api-key': process.env.COINGECKO_API_KEY
    };

    try {
        const response = await axios.get(url, { params, headers });
        logger.info("Fetched token prices successfully.");
        return response.data;
    } catch (error) {
        logger.error(`Error fetching token prices: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchTokenPrices };
