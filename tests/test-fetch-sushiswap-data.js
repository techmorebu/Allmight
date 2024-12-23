const { fetchSushiSwapPairData } = require('../data-collection/fetch-sushiswap-data');
const logger = require('../monitoring/logger'); // Ensure correct import

/**
 * Test SushiSwap pair data fetcher
 */
async function testSushiSwapDataFetcher() {
    try {
        logger.info('Starting SushiSwap pair data fetcher test...');
        console.log('Testing SushiSwap Pair Data Fetcher...');
        
        // Fetch the pair data
        const pairData = await fetchSushiSwapPairData();
        
        logger.info('Successfully fetched SushiSwap pair data.');
        console.log('Fetched Pair Data:', JSON.stringify(pairData, null, 2));
    } catch (error) {
        console.error(`Error during test: ${error.message}`);
        logger.error(`Error during test: ${error.message}`);
    }
}

// Execute the test
testSushiSwapDataFetcher();
