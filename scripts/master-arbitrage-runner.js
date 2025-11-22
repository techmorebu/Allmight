//Legacy

const { startGmxWebSocket } = require('../data-collection/fetch-gmx-websocket');
const { startUniswapWebSocket } = require('../data-collection/fetch-uniswap-websocket');
const { startDydxWebSocket } = require('../data-collection/fetch-dydx-websocket');
const { startXrplWebSocket } = require('../data-collection/fetch-xrpl-websocket');
const { fetchThorchainPools } = require('../data-collection/fetch-thorchain-data');
const { analyzePrices } = require('../analyzers/price-analyzer');
const { sendGeneralNotification } = require('../monitoring/notifier');
const logger = require('../monitoring/logger');
const { performance } = require('perf_hooks');

require('dotenv').config();

/**
 * Retry logic for WebSocket connections and data fetchers
 * @param {function} fetcherFunction - Function to establish a WebSocket connection or fetch data
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} delay - Delay between retries in milliseconds
 */
async function retryConnection(fetcherFunction, maxRetries = 3, delay = 5000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await fetcherFunction();
            logger.info(`✅ Connection successful after ${attempt} attempt(s).`);
            break;
        } catch (error) {
            logger.error(`❌ Connection attempt ${attempt} failed: ${error.message}`);
            if (attempt < maxRetries) {
                logger.info(`Retrying in ${delay / 1000} seconds...`);
                await new Promise((resolve) => setTimeout(resolve, delay));
            } else {
                logger.error('❌ All connection attempts failed.');
                throw error;
            }
        }
    }
}

/**
 * Master function to run the arbitrage detection system in simulation mode
 */
async function startArbitrageSystemSimulation() {
    try {
        logger.info('🚀 Starting Allmight Arbitrage System (Simulation Mode)...');
        await sendGeneralNotification('🚀 **Allmight Arbitrage System Started (Simulation Mode)**.');

        // Step 1: Start Real-Time Data Fetchers and Thorchain Fetcher
        logger.info('⏳ Connecting to WebSocket fetchers and fetching Thorchain data...');
        await retryConnection(startGmxWebSocket);
        await retryConnection(startUniswapWebSocket);
        await retryConnection(startDydxWebSocket);
        await retryConnection(startXrplWebSocket);
        await retryConnection(fetchThorchainPools);

        logger.info('✅ All data sources connected (Simulation Mode).');
        await sendGeneralNotification('✅ **All data sources connected (Simulation Mode).**');

        // Step 2: Run Price Analyzer Continuously
        logger.info('🔍 Monitoring for arbitrage opportunities (Simulation Mode)...');
        await sendGeneralNotification('🔍 **Monitoring for arbitrage opportunities (Simulation Mode)...**');

        setInterval(async () => {
            try {
                const startTime = performance.now();
                await analyzePrices(); // Analyze prices but skip live trade execution
                const endTime = performance.now();
                const executionTime = (endTime - startTime).toFixed(2);

                logger.info(`✅ Price analysis completed in ${executionTime} ms (Simulation Mode).`);
            } catch (error) {
                logger.error(`❌ Error in price analysis loop: ${error.message}`);
                await sendGeneralNotification(`❌ **Error in price analysis:** ${error.message}`);
            }
        }, parseInt(process.env.ANALYZER_INTERVAL_MS) || 10000); // Default 10 seconds
    } catch (error) {
        logger.error(`❌ Critical system failure: ${error.message}`);
        await sendGeneralNotification(`❌ **Critical Failure:** ${error.message}`);
    }
}

startArbitrageSystemSimulation();
