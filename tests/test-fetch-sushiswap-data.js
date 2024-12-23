const { fetchSushiSwapPairData } = require('../data-collection/fetch-sushiswap-data');
const logger = require('../monitoring/logger');

async function testSushiSwapDataFetcher() {
    try {
        logger.info('Starting SushiSwap pair data fetcher test...');

        // Fetch data
        const data = await fetchSushiSwapPairData();

        // Log and display the results
        logger.info('Fetched pair data successfully', { pairCount: data.length });
        console.log('Fetched Pair Data:', JSON.stringify(data, null, 2));
    } catch (error) {
        logger.error(`Error during test: ${error.message}`);
        console.error('Error stack:', error.stack);
    }
}

// Execute the test function
testSushiSwapDataFetcher();
