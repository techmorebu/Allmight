const WebSocketManager = require('./websocket-manager');
require('dotenv').config();

const DYDX_WEBSOCKET_URL = process.env.DYDX_WEBSOCKET_URL || 'wss://api.dydx.exchange/v3/ws';

/**
 * Handle incoming messages from dYdX WebSocket
 * @param {object} data - Parsed WebSocket data
 */
function handleDydxMessage(data) {
    console.log('dYdX Update:', JSON.stringify(data, null, 2));
    // Process specific updates like trades, order book changes, etc.
}

/**
 * Subscribe to dYdX channels
 * @param {object} ws - WebSocket connection
 * @param {string} channel - Channel to subscribe to (e.g., 'trades', 'orderbook')
 * @param {string} market - Market symbol (e.g., 'BTC-USD')
 */
function subscribeDydxChannel(ws, channel, market) {
    const subscriptionMessage = {
        type: 'subscribe',
        channel: channel,
        id: market,
    };
    ws.send(JSON.stringify(subscriptionMessage));
}

/**
 * Start dYdX WebSocket connection
 */
function startDydxWebSocket() {
    WebSocketManager.connect('dYdX', DYDX_WEBSOCKET_URL, (data) => {
        if (data.type === 'channel_data') {
            handleDydxMessage(data.contents);
        }
    });

    // Subscribe to trades and order book for BTC-USD after connecting
    setTimeout(() => {
        const ws = WebSocketManager.connections['dYdX'];
        if (ws) {
            subscribeDydxChannel(ws, 'trades', 'BTC-USD');
            subscribeDydxChannel(ws, 'orderbook', 'BTC-USD');
        }
    }, 2000);
}

module.exports = { startDydxWebSocket };
