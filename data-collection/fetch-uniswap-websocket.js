const WebSocketManager = require('./websocket-manager');
require('dotenv').config();

const UNISWAP_WEBSOCKET_URL = process.env.UNISWAP_WEBSOCKET_URL || 'wss://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';

/**
 * Handle incoming messages from Uniswap WebSocket
 * @param {object} data - Parsed WebSocket data
 */
function handleUniswapMessage(data) {
    console.log('Uniswap Update:', JSON.stringify(data, null, 2));
    // Process the real-time Uniswap updates here (e.g., swaps, pool changes)
}

/**
 * Start Uniswap WebSocket connection
 */
function startUniswapWebSocket() {
    WebSocketManager.connect('Uniswap', UNISWAP_WEBSOCKET_URL, handleUniswapMessage);
}

module.exports = { startUniswapWebSocket };
