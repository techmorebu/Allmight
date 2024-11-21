require("dotenv").config();
const axios = require("axios");
const { logger } = require("../monitoring/logger");

// Fetch token prices using CoinGecko API
async function fetchTokenPrices() {
    const url = 'https://api.coingecko.com/api/v3/simple/price';
    const params = {
        ids: 'bitcoin,ethereum,polygon',
        vs_currencies: 'usd'
    };

    // Include API key if using CoinGecko's Pro API
    if (process.env.COINGECKO_API_KEY) {
        params.x_cg_pro_api_key = process.env.COINGECKO_API_KEY;
    }

    try {
        const response = await axios.get(url, { params });
        logger.info("Fetched token prices successfully.");
        return response.data;
    } catch (error) {
        logger.error(`Error fetching token prices: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchTokenPrices };
