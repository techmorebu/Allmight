const { logger } = require('../monitoring/logger');

function calculateSpread(orderBook) {
    const { bestBid, bestAsk } = orderBook;
    if (bestBid && bestAsk) {
        const spread = parseFloat(bestAsk.price) - parseFloat(bestBid.price);
        return { market: orderBook.market, spread };
    }
    return null;
}

function analyzeData(parsedData) {
    if (parsedData.type === 'orderbook') {
        const spreadInfo = calculateSpread(parsedData);
        if (spreadInfo) {
            logger.info(`Market: ${spreadInfo.market}, Spread: ${spreadInfo.spread}`);
        }
    }
}
