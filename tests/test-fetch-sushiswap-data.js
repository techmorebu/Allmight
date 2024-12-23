const { fetchSushiswapPairData } = require('../data-collection/fetch-sushiswap-data');

(async () => {
    console.log('Testing SushiSwap Pair-Level Data Fetcher...');
    try {
        const pairs = await fetchSushiSwapPairData();

        // Validate output
        if (!Array.isArray(pairs) || pairs.length === 0) {
            throw new Error('Fetcher returned no pair data');
        }

        console.log('Test Passed: SushiSwap fetcher returned valid data');
        console.log(JSON.stringify(pairs, null, 2));
    } catch (err) {
        // Ensure `err` is an object before accessing properties
        const errorMessage = err?.message || 'Unknown error during test';
        console.error(`Error during test: ${errorMessage}`);
    }
})();
