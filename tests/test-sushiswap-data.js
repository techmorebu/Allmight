const { fetchSushiSwapData } = require('../data-collection/fetch-sushiswap-data');

(async () => {
    console.log('Testing SushiSwap Pair-Level Data Fetcher...');
    try {
        const data = await fetchSushiSwapData();
        console.log('Fetched Data:', data);
    } catch (error) {
        console.error('Error during test:', error.message);
    }
})();
