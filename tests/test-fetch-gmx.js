require('dotenv').config();
const { fetchGmxData } = require('../data-collection/fetch-gmx-data');
const logger = require('../monitoring/logger');

(async () => {
    try {
        logger.info('Testing GMX fetch for Arbitrum - Tickers...');
        const arbitrumTickers = await fetchGmxData('arbitrum', 'tickers');
        logger.info(`Fetched Arbitrum Tickers: ${JSON.stringify(arbitrumTickers)}`);

        logger.info('Testing GMX fetch for Avalanche - Tickers...');
        const avalancheTickers = await fetchGmxData('avalanche', 'tickers');
        logger.info(`Fetched Avalanche Tickers: ${JSON.stringify(avalancheTickers)}`);

        logger.info('Testing GMX fetch for Arbitrum - Candles...');
        const arbitrumCandles = await fetchGmxData('arbitrum', 'candles', { tokenSymbol: 'ETH', period: '1m' });
        logger.info(`Fetched Arbitrum Candles: ${JSON.stringify(arbitrumCandles)}`);
    } catch (error) {
        logger.error(`Error testing fetchGmxData: ${error.message}`);
    }
})();
