const WebSocketManager = require('./websocket-manager');
require('dotenv').config();

const GMX_WEBSOCKET_URL = process.env.GMX_WEBSOCKET_URL || 'wss://api.gmx.io/arb';

function handleGmxMessage(data) {
    console.log('GMX Update:', data);
    // Process incoming trades or candlestick data here
}

function startGmxWebSocket() {
    WebSocketManager.connect('GMX', GMX_WEBSOCKET_URL, handleGmxMessage);
}

module.exports = { startGmxWebSocket };
