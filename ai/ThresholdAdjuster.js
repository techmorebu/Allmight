const thresholds = require('../config/trading_thresholds.json');

function adjustThresholds(successRate) {
    if (successRate < 0.5) {
        thresholds.arbitrage_min_spread -= 0.01;
        thresholds.pair_trade_sell += 0.01;
        thresholds.pair_trade_buy -= 0.01;
    } else if (successRate > 0.7) {
        thresholds.arbitrage_min_spread += 0.01;
        thresholds.pair_trade_sell -= 0.01;
        thresholds.pair_trade_buy += 0.01;
    }
    console.log("Thresholds updated:", thresholds);
}

module.exports = { adjustThresholds };
