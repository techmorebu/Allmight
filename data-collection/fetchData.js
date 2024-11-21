require("dotenv").config();
const axios = require("axios");
const { logger } = require("../monitoring/logger");

// Fetch token prices using CoinGecko API
async function fetchTokenPrices() {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=ethereum,polygon,zksync&vs_currencies=usd&x_cg_pro_api_key=${process.env.COINGECKO_API_KEY}`;
    try {
        const response = await axios.get(url);
        logger.info("Fetched token prices successfully.");
        return response.data;
    } catch (error) {
        logger.error(`Error fetching token prices: ${error.message}`);
        throw error;
    }
}

// Fetch liquidity pool data using Uniswap The Graph API
async function fetchLiquidityData() {
    const graphAPI = process.env.UNISWAP_API_KEY;
    try {
        const response = await axios.post(graphAPI, {
            query: `
            {
                pools(first: 5) {
                    id
                    token0 {
                        symbol
                    }
                    token1 {
                        symbol
                    }
                    totalLiquidity
                }
            }
            `,
        });
        logger.info("Fetched liquidity pool data successfully.");
        return response.data.data.pools;
    } catch (error) {
        logger.error(`Error fetching liquidity data: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchTokenPrices, fetchLiquidityData };
