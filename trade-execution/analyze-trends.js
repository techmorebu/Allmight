/**
 * Analyze trends based on GMX combined data.
 * @param {Object} data - Combined GMX data (tickers, candles, etc.).
 * @returns {Object} - Trends data.
 */
function analyzeTrends(data) {
    const trends = {};

    for (const [network, networkData] of Object.entries(data)) {
        const tickers = networkData.tickers || [];
        const candles = networkData.candles || [];

        trends[network] = {
            priceTrends: tickers.map(ticker => ({
                symbol: ticker.tokenSymbol,
                minPrice: ticker.minPrice,
                maxPrice: ticker.maxPrice,
            })),
            candlestickTrends: candles.map(candle => ({
                symbol: candle.tokenSymbol,
                open: candle.open,
                close: candle.close,
                high: candle.high,
                low: candle.low,
            })),
        };
    }

    return trends;
}

module.exports = { analyzeTrends };
