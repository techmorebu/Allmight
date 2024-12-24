const { startFetcher } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');

(async () => {
    logger.info('Starting dYdX WebSocket fetcher test...');
    await startFetcher();
    logger.info('Test completed.');
})();
