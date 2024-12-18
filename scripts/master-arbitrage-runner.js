const { startGmxWebSocket } = require('../data-collection/fetch-gmx-websocket');
const { startUniswapWebSocket } = require('../data-collection/fetch-uniswap-websocket');
const { startDydxWebSocket } = require('../data-collection/fetch-dydx-websocket');
const { startXrplWebSocket } = require('../data-collection/fetch-xrpl-websocket');
const { analyzePrices } = require('../analyzers/price-analyzer');
const { sendGeneralNotification } = require('../monitoring/notifier');
const logger = require('../monitoring/logger');

require('dotenv').config();

/**
 * Simulate arbitrage system without executing trades.
 */
async function startArbitrageSystemSimulation() {
    try {
        logger.info('🚀 Starting Allmight Arbitrage System (Simulation Mode)...');
        await sendGeneralNotification('🚀 **Allmight Arbitrage System Started (Simulation Mode)**.');

        // Step 1: Start Real-Time Data Fetchers
        logger.info('⏳ Connecting to WebSocket fetchers...');
        startGmxWebSocket();
        startUniswapWebSocket();
        startDydxWebSocket();
        startXrplWebSocket();
        logger.info('✅ WebSocket connections established (Simulation Mode).');
        await sendGeneralNotification('✅ **WebSocket connections established (Simulation Mode).**');

        // Step 2: Run Price Analyzer Continuously
        logger.info('🔍 Monitoring for arbitrage opportunities (Simulation Mode)...');

        setInterval(async () => {
            try {
                await analyzePrices(); // Analyze prices but skip trade execution
                logger.info('✅ Price analysis completed (Simulation Mode).');
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
