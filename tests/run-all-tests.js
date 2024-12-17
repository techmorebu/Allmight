const { fetchTokenPrices } = require('../data-collection/fetchData');
const { fetchGmxData, fetchGmxCandlesticks } = require('../data-collection/fetch-gmx-data');
const { fetchPoolData } = require('../data-collection/fetch-pool-data');
const { fetchUniswapData } = require('../data-collection/fetch-uniswap-data');

(async () => {
    try {
        console.log('--- Testing Token Prices ---');
        const tokenPrices = await fetchTokenPrices();
        console.log('Token Prices:', tokenPrices);

        console.log('--- Testing GMX Candlesticks ---');
        const gmxCandlesticks = await fetchGmxCandlesticks('arbitrum', 'ETH', '1d');
        console.log('GMX Candlesticks:', gmxCandlesticks);

        console.log('--- Testing GMX Tickers ---');
        const gmxTickers = await fetchGmxData('arbitrum', 'tickers');
        console.log('GMX Tickers:', gmxTickers);

        console.log('--- Testing Uniswap Pool Data ---');
        const uniswapPools = await fetchUniswapData();
        console.log('Uniswap Pools:', uniswapPools);

        console.log('--- Testing Uniswap Specific Pool Data ---');
        const poolData = await fetchPoolData(
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
        );
        console.log('Specific Pool Data:', poolData);
    } catch (error) {
        console.error('Error running tests:', error.message);
    }
})();
