require('dotenv').config();
const { fetchGmxData } = require('../data-collection/fetch-gmx-data');
const { logger } = require('../monitoring/logger');

(async () => {
    try {
        logger.info('Testing GMX fetch for Arbitrum - Tickers...');
        const arbitrumTickers = await fetchGmxData('arbitrum', 'tickers');
        console.log('Arbitrum Tickers:', arbitrumTickers);

        logger.info('Testing GMX fetch for Avalanche - Tickers...');
        const avalancheTickers = await fetchGmxData('avalanche', 'tickers');
        console.log('Avalanche Tickers:', avalancheTickers);

        logger.info('Testing GMX fetch for Arbitrum - Candles...');
        const arbitrumCandles = await fetchGmxData('arbitrum', 'candles');
        console.log('Arbitrum Candles:', arbitrumCandles);
    } catch (error) {
        console.error('Error testing fetchGmxData:', error.message);
    }
})();
