const { startGmxWebSocket } = require('../data-collection/fetch-gmx-websocket');
const { startUniswapWebSocket } = require('../data-collection/fetch-uniswap-websocket');
const { startDydxWebSocket } = require('../data-collection/fetch-dydx-websocket');
const { startXrplWebSocket } = require('../data-collection/fetch-xrpl-websocket');
const { analyzePrices } = require('../analyzers/price-analyzer');

require('dotenv').config();

/**
 * Master function to run the arbitrage detection system
 */
async function startArbitrageSystem() {
    console.log('🚀 Starting Allmight Arbitrage System...');

    // Step 1: Start Real-Time Data Fetchers
    console.log('⏳ Connecting to WebSocket fetchers...');
    startGmxWebSocket();
    startUniswapWebSocket();
    startDydxWebSocket();
    startXrplWebSocket();

    console.log('✅ WebSocket connections established.');

    // Step 2: Run Price Analyzer Continuously
    console.log('🔍 Monitoring for arbitrage opportunities...');

    setInterval(async () => {
        try {
            await analyzePrices();
        } catch (error) {
            console.error('❌ Error in price analysis loop:', error.message);
        }
    }, parseInt(process.env.ANALYZER_INTERVAL_MS) || 10000); // Default 10 seconds
}

startArbitrageSystem();
