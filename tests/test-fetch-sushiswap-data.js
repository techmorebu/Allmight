const { fetchSushiSwapPairData } = require('../fetchers/fetch-sushiswap-pair-data');

(async () => {
    try {
        console.log('Testing SushiSwap REST API Pair Data Fetcher...');
        const data = await fetchSushiSwapPairData();
        console.log('Fetched pair data:', data);
    } catch (error) {
        console.error('Error during test:', error.message);
    }
})();
