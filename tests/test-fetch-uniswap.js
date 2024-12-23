const { fetchUniswapData } = require('../data-collection/fetch-uniswap-data');

(async () => {
    try {
        console.log('Testing Uniswap Pool Data...');
        const pools = await fetchUniswapData();
        console.log('Fetched Uniswap Pools:', pools);
    } catch (error) {
        console.error('Error fetching Uniswap data:', error.message);
    }
})();
