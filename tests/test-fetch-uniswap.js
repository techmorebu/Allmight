const { fetchUniswapPairData } = require('../data-collection/fetch-uniswap-data');

(async () => {
    console.log('Testing Uniswap Pair-Level Data Fetcher...');
    try {
        const pairs = await fetchUniswapPairData();
        console.log('Fetched Pair-Level Data:', pairs);
    } catch (error) {
        console.error('Error during test:', error.message);
    }
})();
