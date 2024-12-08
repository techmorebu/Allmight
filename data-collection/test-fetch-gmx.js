require('dotenv').config({ path: '../../.env' });
const { fetchGmxTokenPrices } = require('./fetch-gmx-data');
const { logger } = require('../monitoring/logger'); // Ensure this points to the logger module in your project

async function testFetchGmxData() {
    try {
        logger.info('--- Starting GMX Data Fetch Test ---');

        // Test Arbitrum endpoint
        logger.info('Testing GMX Arbitrum endpoint...');
        const arbitrumPrices = await fetchGmxTokenPrices('arbitrum');
        logger.info(`Arbitrum Prices: ${JSON.stringify(arbitrumPrices, null, 2)}`);

        // Test Avalanche endpoint
        logger.info('Testing GMX Avalanche endpoint...');
        const avalanchePrices = await fetchGmxTokenPrices('avalanche');
        logger.info(`Avalanche Prices: ${JSON.stringify(avalanchePrices, null, 2)}`);

        logger.info('--- GMX Data Fetch Test Completed Successfully ---');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
}

testFetchGmxData();
