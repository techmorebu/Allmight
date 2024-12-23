const { fetchSushiSwapPairData } = require('../data-collection/fetch-sushiswap-data');
const logger = require('../monitoring/logger'); // Correctly import the logger

/**
 * Test SushiSwap pair data fetcher
 */
async function testSushiSwapDataFetcher() {
    try {
        logger.info('Testing SushiSwap pair data fetcher...');
        console.log('Starting test...');
        
        // Fetch the pair data
        const pairData = await fetchSushiSwapPairData();
        
        logger.info('Successfully fetched SushiSwap pair data.');
        console.log('Fetched Pair Data:', JSON.stringify(pairData, null, 2)); // Pretty print the data
    } catch (error) {
        console.error(`Error during test: ${error.message}`);
        logger.error(`Error during test: ${error.message}`); // Properly log the error
    }
}

// Execute the test
testSushiSwapDataFetcher();
