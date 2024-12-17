const { fetchGmxCandlesticks } = require('../data-collection/fetch-gmx-data');

async function testFetchGmxCandlesticks() {
    try {
        console.log('Testing GMX Candlesticks Fetch for Arbitrum...');
        const arbitrumCandlesticks = await fetchGmxCandlesticks('arbitrum', 'ETH', '1d');
        console.log('Arbitrum Candlesticks:', arbitrumCandlesticks);

        console.log('Testing GMX Candlesticks Fetch for Avalanche...');
        const avalancheCandlesticks = await fetchGmxCandlesticks('avalanche', 'AVAX', '1d');
        console.log('Avalanche Candlesticks:', avalancheCandlesticks);
    } catch (error) {
        console.error('Error testing fetchGmxCandlesticks:', error.message);
    }
}

testFetchGmxCandlesticks();
