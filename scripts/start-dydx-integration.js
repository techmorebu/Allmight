// Importing the logger as a named export
const { logger } = require('../monitoring/logger');
const { connectToDYDX } = require('../data-collection/fetch-dydx-data');

// Function to test dYdX integration
async function startIntegrationTest() {
    try {
        logger.info('Starting dYdX Integration Test...');

        logger.info('Testing WebSocket connection...');
        await connectToDYDX();

        logger.info('WebSocket connection successful. Integration Test Passed.');
    } catch (error) {
        logger.error(`Test Failed: ${error.message}`);
    } finally {
        logger.info('Integration Test Completed.');
    }
}

// Run the integration test
startIntegrationTest();
