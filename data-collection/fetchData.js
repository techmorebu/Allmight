require("dotenv").config();
const axios = require("axios");
const { logAndNotify } = require("../monitoring/logger");

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
        logAndNotify("info", "Fetching token prices from CoinGecko...");
        const response = await axios.get(url, { params, headers });
        logAndNotify("info", "Fetched token prices successfully.");
        return response.data;
    } catch (error) {
        logAndNotify("error", `Error fetching token prices: ${error.message}`);
        throw error; // Rethrow the error for higher-level handling
    }
}

// Test the function
if (require.main === module) {
    fetchTokenPrices()
        .then(data => logAndNotify("info", `Token Prices: ${JSON.stringify(data)}`))
        .catch(error => logAndNotify("error", `Fetch failed: ${error.message}`));
}

module.exports = { fetchTokenPrices };
