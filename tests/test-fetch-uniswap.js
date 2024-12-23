const { fetchUniswapData } = require('../data-collection/fetch-uniswap-data');

(async () => {
    try {
        console.log('Testing Uniswap Pool Data...');
        const pools = await  fetchUniswapPairData();
        console.log('Fetched Uniswap Pair Data cuh..:', pools);
    } catch (error) {
        console.error('Error fetching Uniswap data:', error.message);
    }
})();
