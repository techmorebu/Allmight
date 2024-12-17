const { fetchDydxMarkets, fetchDydxOrderBook, fetchDydxTrades } = require('../data-collection/fetch-dydx-data');

(async () => {
    try {
        console.log('--- Testing dYdX Market Data ---');
        const markets = await fetchDydxMarkets();
        console.log('Markets:', JSON.stringify(markets, null, 2));

        console.log('--- Testing dYdX Order Book for BTC-USD ---');
        const orderBook = await fetchDydxOrderBook('BTC-USD');
        console.log('Order Book:', JSON.stringify(orderBook, null, 2));

        console.log('--- Testing dYdX Recent Trades for BTC-USD ---');
        const trades = await fetchDydxTrades('BTC-USD');
        console.log('Recent Trades:', JSON.stringify(trades, null, 2));
    } catch (error) {
        console.error('Error testing dYdX fetchers:', error.message);
    }
})();
