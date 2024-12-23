const { fetchSushiSwapPairData } = require('../data-collection/fetch-sushiswap-data');
const { logger } = require('../monitoring/logger');

async function testSushiSwapDataFetcher() {
    console.log('Testing SushiSwap REST API Pair Data Fetcher...');

    try {
        // Call the fetcher and display the data
        const pairData = await fetchSushiSwapPairData();
        console.log('Fetched pair data:', pairData);
    } catch (error) {
        // Log the entire error object to debug the issue
        logger.error(`Error during test: ${error.message}`);
        console.error('Error details:', error); // Log the full error object
    }
}

testSushiSwapDataFetcher();
