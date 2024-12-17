const { fetchPoolData } = require('../data-collection/fetch-pool-data');

(async () => {
    try {
        console.log('Testing Uniswap Pool Fetch...');
        const poolData = await fetchPoolData(
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
            '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'  // WETH
        );
        console.log('Pool Data:', poolData);
    } catch (error) {
        console.error('Error fetching Uniswap pool data:', error.message);
    }
})();
