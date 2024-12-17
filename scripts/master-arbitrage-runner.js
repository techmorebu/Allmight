const { startGmxWebSocket } = require('../data-collection/fetch-gmx-websocket');
const { startUniswapWebSocket } = require('../data-collection/fetch-uniswap-websocket');
const { startDydxWebSocket } = require('../data-collection/fetch-dydx-websocket');
const { startXrplWebSocket } = require('../data-collection/fetch-xrpl-websocket');
const { analyzePrices } = require('../analyzers/price-analyzer');
const logger = require('../monitoring/logger');
const { sendNotification } = require('../monitoring/notifier');

require('dotenv').config();

/**
 * Master function to run the arbitrage detection system
 */
async function startArbitrageSystem() {
    logger.info('🚀 Starting Allmight Arbitrage System...');

    // Step 1: Start Real-Time Data Fetchers
    logger.info('⏳ Connecting to WebSocket fetchers...');
    startGmxWebSocket();
    startUniswapWebSocket();
    startDydxWebSocket();
    startXrplWebSocket();

    logger.info('✅ WebSocket connections established.');

    // Send notification for startup
    await sendNotification('🚀 Allmight Arbitrage System Started.');

    // Step 2: Run Price Analyzer Continuously
    logger.info('🔍 Monitoring for arbitrage opportunities...');

    setInterval(async () => {
        try {
            await analyzePrices();
            logger.info('✅ Price analysis completed.');
        } catch (error) {
            logger.error(`❌ Error in price analysis loop: ${error.message}`);
            await sendNotification(`❌ Error in price analysis: ${error.message}`);
        }
    }, parseInt(process.env.ANALYZER_INTERVAL_MS) || 10000); // Default 10 seconds
}

startArbitrageSystem();
