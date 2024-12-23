// Required libraries
const { fetchSushiSwapData } = require('../data-collection/fetch-sushiswap-data');
const assert = require('assert');

(async () => {
    console.log('Testing SushiSwap Pair-Level Data Fetcher...');

    try {
        const pairs = await fetchSushiSwapData();
        
        // Ensure the fetcher returns an array
        assert(Array.isArray(pairs), 'Fetcher did not return an array');
        
        // Ensure the array is not empty
        assert(pairs.length > 0, 'Fetcher returned an empty array');
        
        // Validate the structure of the first item
        const firstPair = pairs[0];
        assert(firstPair.id, 'First pair does not have an id');
        assert(firstPair.pair, 'First pair does not have a pair field');
        assert(typeof firstPair.price === 'number', 'First pair price is not a number');
        assert(typeof firstPair.volumeUSD === 'number', 'First pair volumeUSD is not a number');

        console.log('SushiSwap Pair-Level Data Fetcher test passed.');
    } catch (error) {
        console.error('Error during test:', error.message);
    }
})();
