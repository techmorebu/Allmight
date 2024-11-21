// modules/data-collection/data-collection.js
require("dotenv").config();
const { ethers } = require("ethers");
const nodeFetch = require("node-fetch");

async function getPriceData() {
    try {
        const response = await nodeFetch(`${process.env.COINGECKO_API_KEY}/simple/price?ids=ethereum&vs_currencies=usd`);
        const data = await response.json();
        console.log("Price Data:", data);
        return data.ethereum.usd;
    } catch (error) {
        console.error("Error fetching price data:", error.message);
        throw error;
    }
}

async function getLiquidityData(dexApiUrl) {
    try {
        const response = await nodeFetch(dexApiUrl);
        const data = await response.json();
        console.log("Liquidity Data:", data);
        return data;
    } catch (error) {
        console.error("Error fetching liquidity data:", error.message);
        throw error;
    }
}

module.exports = { getPriceData, getLiquidityData };
