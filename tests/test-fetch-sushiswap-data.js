const { fetchSushiSwapPairData } = require('../data-collection/fetch-sushiswap-data');
const { logger } = require('../monitoring/logger');

async function testSushiSwapDataFetcher() {
    console.log('Testing SushiSwap REST API Pair Data Fetcher...');
    
    try {
        // Fetch the pair data
        const pairData = await fetchSushiSwapPairData();
        console.log('Fetched pair data:', pairData);
    } catch (error) {
        // Ensure the error is logged properly
        const errorMessage = error.message || 'Unknown error occurred';
        logger.error(`Error during test: ${errorMessage}`);
        console.error('Error details:', error); // Log the full error object for debugging
    }
}

testSushiSwapDataFetcher();
