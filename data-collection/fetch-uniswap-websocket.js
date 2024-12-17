const WebSocketManager = require('./websocket-manager');
const redisClient = require('../utils/redis-client');
require('dotenv').config();

const UNISWAP_WEBSOCKET_URL = process.env.UNISWAP_WEBSOCKET_URL || 'wss://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';

/**
 * Handle incoming Uniswap WebSocket messages
 * @param {object} data - Parsed WebSocket message
 */
function handleUniswapMessage(data) {
    console.log('Received Uniswap Data:', data);

    // Cache pool update data into Redis
    const key = `Uniswap:Pool:${Date.now()}`;
    redisClient.set(key, JSON.stringify(data), 'EX', 60); // Expires after 60 seconds
}

/**
 * Start Uniswap WebSocket connection
 */
function startUniswapWebSocket() {
    WebSocketManager.connect('Uniswap', UNISWAP_WEBSOCKET_URL, handleUniswapMessage);
}

module.exports = { startUniswapWebSocket };
