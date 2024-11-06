const tradeEvaluator = require('../ai/TradeEvaluator');
const logger = require('../ai/Logger');
const thresholds = require('../config/trading_thresholds.json');

async function mainTradingCycle() {
    try {
        const maticPrice = await tradeEvaluator.getPrice('MATIC');
        const assetPrice = await tradeEvaluator.getPrice('ETH');
        let maticBalance = 0.4;

        if (tradeEvaluator.evaluateArbitrage(assetPrice, maticPrice)) {
            tradeEvaluator.executeArbitrageTrade();
            logger.logTrade("Arbitrage Trade Executed", { assetPrice, maticPrice });
        } else {
            tradeEvaluator.evaluatePairTradeDecision(maticBalance, assetPrice, maticPrice);
            logger.logTrade("Pair Trade Executed", { maticBalance, assetPrice, maticPrice });
        }
    } catch (error) {
        console.error("Error in trading cycle:", error);
    }
}

setInterval(mainTradingCycle, 60000);
