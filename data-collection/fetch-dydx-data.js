const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');

const DYDX_WEBSOCKET_URL = 'wss://api.dydx.exchange/v3/ws'; // Ensure this URL is correct

/**
 * Connect to the dYdX WebSocket and handle data
 */
function connectToDYDX(markets = ['BTC-USD', 'ETH-USD'], handleMessage) {
    const ws = new WebSocket(DYDX_WEBSOCKET_URL);

    ws.on('open', () => {
        logger.info('Connected to dYdX WebSocket');

        markets.forEach((market) => {
            const subscriptionPayload = {
                type: 'subscribe',
                channel: 'v3_orderbook', // Corrected channel name
                id: market, // Market ticker used as the subscription ID
            };

            ws.send(JSON.stringify(subscriptionPayload));
            logger.info(`Subscribed to market: ${market}`);
        });
    });

    ws.on('message', (data) => {
        const message = JSON.parse(data);

        if (message.type === 'subscribed') {
            logger.info(`Subscription confirmed for channel: ${message.channel}, market: ${message.id}`);
        } else if (message.type === 'v3_orderbook') {
            handleMessage(message);
        } else if (message.type === 'error') {
            logger.error(`Error from dYdX: ${message.message} (Details: ${JSON.stringify(message)})`);
        } else {
            logger.info(`Unhandled message type: ${JSON.stringify(message)}`);
        }
    });

    ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
    });

    ws.on('close', () => {
        logger.warn('WebSocket connection closed. Attempting to reconnect...');
        setTimeout(() => connectToDYDX(markets, handleMessage), 5000); // Reconnect after 5 seconds
    });

    return ws;
}

module.exports = { connectToDYDX };
