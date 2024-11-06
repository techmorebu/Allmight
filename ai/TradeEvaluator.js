require('dotenv').config();
const axios = require('axios');
const thresholds = require('../config/trading_thresholds.json');

async function getPrice(asset) {
    const response = await axios.get(`https://api.dex.com/prices/${asset}`);
    return response.data.price;
}

function evaluateArbitrage(assetPrice, maticPrice) {
    const spread = maticPrice / assetPrice;
    return spread >= thresholds.arbitrage_min_spread;
}

function executeArbitrageTrade() {
    console.log("Executing arbitrage trade...");
}

function evaluatePairTradeDecision(maticBalance, assetPrice, maticPrice) {
    const ratio = maticPrice / assetPrice;

    if (ratio > thresholds.pair_trade_sell && maticBalance > thresholds.max_matic_utilization) {
        console.log("Sell asset for MATIC - pair trading fallback");
    } else if (ratio < thresholds.pair_trade_buy && maticBalance < thresholds.max_matic_utilization) {
        console.log("Buy MATIC with asset - pair trading fallback");
    }
}

module.exports = {
    getPrice,
    evaluateArbitrage,
    executeArbitrageTrade,
    evaluatePairTradeDecision
};
