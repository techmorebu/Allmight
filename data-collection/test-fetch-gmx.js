require('dotenv').config({ path: '../../.env' });
const { fetchGmxTokenPrices } = require('./fetch-gmx-data');
const { logger } = require('../monitoring/logger');

(async () => {
    try {
        // Test fetching tickers data for Arbitrum
        logger.info('Testing GMX fetch for Arbitrum - Tickers');
        const arbitrumTickers = await fetchGmxTokenPrices('arbitrum', 'tickers');
        console.log('Arbitrum Tickers:', arbitrumTickers);

        // Test fetching tickers data for Avalanche
        logger.info('Testing GMX fetch for Avalanche - Tickers');
        const avalancheTickers = await fetchGmxTokenPrices('avalanche', 'tickers');
        console.log('Avalanche Tickers:', avalancheTickers);

        // Add tests for other endpoint types if needed
        logger.info('Testing GMX fetch for Arbitrum - Candles');
        const arbitrumCandles = await fetchGmxTokenPrices('arbitrum', 'candles');
        console.log('Arbitrum Candles:', arbitrumCandles);

    } catch (error) {
        console.error('Error testing fetch-gmx-data:', error.message);
    }
})();
