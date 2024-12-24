const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');

const DYDX_WEBSOCKET_URL = 'wss://api.dydx.exchange/v3/ws';
const markets = ['BTC-USD', 'ETH-USD']; // Markets to subscribe

let ws;

/**
 * Subscribe to market order books.
 */
function subscribeToMarkets() {
    markets.forEach((market) => {
        const subscriptionMessage = {
            type: 'subscribe',
            channel: 'v3_orderbook',
            market: market, // Ensure market field matches dYdX API expectations
        };

        ws.send(JSON.stringify(subscriptionMessage));
        logger.info(`Subscribed to market: ${market}`);
    });
}


/**
 * Subscribe to market order books.
 */
function subscribeToMarkets() {
    markets.forEach((market, index) => {
        const subscriptionMessage = {
            type: 'subscribe',
            channel: 'v3_orderbook',
            id: `orderbook-${market}-${index}`, // Unique and descriptive subscription ID
            market: market,
        };

        ws.send(JSON.stringify(subscriptionMessage));
        logger.info(`Subscribed to market: ${market}`);
    });
}

/**
 * Handle incoming WebSocket messages.
 * @param {string} data - Incoming message data
 */
function handleWebSocketMessage(data) {
    try {
        const message = JSON.parse(data);

        if (message.type === 'subscribed' && message.channel === 'v3_orderbook') {
            logger.info(`Subscription confirmed for channel: ${message.channel}, market: ${message.market}`);
        } else if (message.type === 'v3_orderbook') {
            const { market, bids, asks } = message.contents;
            const bestBid = bids[0] || { price: 'N/A', size: 'N/A' };
            const bestAsk = asks[0] || { price: 'N/A', size: 'N/A' };

            logger.info(`Market: ${market}, Best Bid: ${bestBid.price}, Best Ask: ${bestAsk.price}`);
        } else if (message.type === 'error') {
            logger.error(`Error from dYdX: ${message.message} (Details: ${JSON.stringify(message)})`);
        } else {
            logger.info(`Unhandled message type: ${JSON.stringify(message)}`);
        }
    } catch (error) {
        logger.error(`Error parsing WebSocket message: ${error.message}`);
    }
}


module.exports = { connectToDYDX };
