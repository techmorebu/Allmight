const { fetchGmxTokenPrices } = require('./fetch-gmx-data'); // Update the path if needed.
const logger = require('./logger'); // Assuming a logger module is used.

(async () => {
    logger.info('--- Starting Integration Validation ---');

    try {
        const arbitrumPrices = await fetchGmxTokenPrices('https://api.gmx.io/arbitrum', 'Arbitrum');
        const avalanchePrices = await fetchGmxTokenPrices('https://api.gmx.io/avalanche', 'Avalanche');

        if (Object.keys(arbitrumPrices).length === 0) {
            logger.warn('No prices fetched for GMX Arbitrum.');
        }
        if (Object.keys(avalanchePrices).length === 0) {
            logger.warn('No prices fetched for GMX Avalanche.');
        }

        logger.info('GMX Token Prices:', {
            arbitrum: arbitrumPrices,
            avalanche: avalanchePrices,
        });
    } catch (error) {
        logger.error('Error during integration validation:', error.message);
    }

    logger.info('--- Integration Validation Completed ---');
})();
