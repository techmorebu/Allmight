const { fetchSushiSwapPairData } = require('../data-collection/fetch-sushiswap-data');
const { logger } = require('../monitoring/logger');

/**
 * Test the fetchSushiSwapPairData function
 */
async function testSushiSwapDataFetcher() {
    try {
        logger.info('Starting SushiSwap pair data fetcher test...');
        
        const pairData = await fetchSushiSwapPairData();
        
        logger.info(`Fetched pair data: ${JSON.stringify(pairData, null, 2)}`);
    } catch (error) {
        logger.error(`Error during test: ${error.message}`);
        logger.error(`Error stack: ${error.stack}`);
    }
}

testSushiSwapDataFetcher();
