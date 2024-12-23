const { fetchSushiSwapPairData } = require('../data-collection/sushiswap-fetcher');

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
        console.error(`Error during test: ${err.message || err}`);
    }
})();
