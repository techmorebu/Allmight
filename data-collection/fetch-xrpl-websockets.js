const WebSocketManager = require('./websocket-manager');
const redisClient = require('../utils/redis-client');
require('dotenv').config();

const XRPL_WEBSOCKET_URL = process.env.XRPL_MAINNET_URL || 'wss://xrplcluster.com';

/**
 * Handle incoming XRPL messages
 * @param {object} data - Parsed WebSocket message
 */
function handleXrplMessage(data) {
    console.log('Received XRPL Data:', data);

    // Cache ledger updates into Redis
    const key = `XRPL:Ledger:${Date.now()}`;
    redisClient.set(key, JSON.stringify(data), 'EX', 60); // Expires after 60 seconds
}

/**
 * Subscribe to XRPL ledger updates
 * @param {object} ws - WebSocket instance
 */
function subscribeXrpl(ws) {
    ws.send(JSON.stringify({ id: 1, command: 'subscribe', streams: ['ledger'] }));
}

/**
 * Start XRPL WebSocket connection
 */
function startXrplWebSocket() {
    WebSocketManager.connect('XRPL', XRPL_WEBSOCKET_URL, (data) => {
        handleXrplMessage(data);
    });

    setTimeout(() => {
        const ws = WebSocketManager.connections['XRPL'];
        if (ws) subscribeXrpl(ws);
    }, 2000);
}

module.exports = { startXrplWebSocket };
