const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');

const DYDX_WEBSOCKET_URL = 'wss://api.dydx.exchange/v3/ws';

function connectDYDXWebSocket(pair) {
    const ws = new WebSocket(DYDX_WEBSOCKET_URL);

    ws.on('open', () => {
        logger.info('Connected to dYdX WebSocket');
        ws.send(JSON.stringify({
            type: 'subscribe',
            channel: 'v3_orderbook',
            id: pair, // Example: 'BTC-USD'
        }));
    });

    ws.on('message', (data) => {
        const parsedData = JSON.parse(data);

        if (parsedData.type === 'channel_data') {
            logger.info(`Received dYdX data: ${JSON.stringify(parsedData, null, 2)}`);
            // Process data (e.g., order book updates or trades)
        }
    });

    ws.on('error', (error) => {
        logger.error(`WebSocket Error: ${error.message}`);
    });

    ws.on('close', () => {
        logger.info('WebSocket connection closed. Reconnecting...');
        setTimeout(() => connectDYDXWebSocket(pair), 5000);
    });
}

module.exports = { connectDYDXWebSocket };
