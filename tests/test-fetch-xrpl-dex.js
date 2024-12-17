const { fetchXrplOrderBook } = require('../data-collection/fetch-xrpl-dex');

(async () => {
    try {
        console.log('Testing XRPL DEX Order Book Fetch...');
        const orderBook = await fetchXrplOrderBook('XRP/USD', 'testnet');
        console.log('Fetched Order Book:', orderBook);
    } catch (error) {
        console.error('Error testing XRPL DEX fetcher:', error.message);
    }
})();
