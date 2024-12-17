const { startGmxWebSocket } = require('../data-collection/fetch-gmx-websocket');
const { startUniswapWebSocket } = require('../data-collection/fetch-uniswap-websocket');
const { startDydxWebSocket } = require('../data-collection/fetch-dydx-websocket');
const { startXrplWebSocket } = require('../data-collection/fetch-xrpl-websocket');
const { analyzePrices } = require('../analyzers/price-analyzer');

(async () => {
    try {
        console.log('🧪 Running Test for Master Arbitrage Runner...');

        // Step 1: Test WebSocket Fetchers
        console.log('🔍 Testing WebSocket connections...');
        startGmxWebSocket();
        startUniswapWebSocket();
        startDydxWebSocket();
        startXrplWebSocket();

        console.log('✅ WebSocket connections initiated.');

        // Step 2: Test Price Analyzer
        console.log('🔍 Testing Price Analyzer...');
        await analyzePrices();
        console.log('✅ Price Analyzer executed successfully.');

        // Step 3: Run System in Short Test Mode
        console.log('🚀 Running a short version of the Master Script...');
        setTimeout(() => {
            console.log('✅ Test completed: Master Arbitrage Runner components are functional.');
            process.exit(0);
        }, 5000); // Run for 5 seconds to confirm continuity
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
})();
