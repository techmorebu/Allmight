const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');

// WebSocket URL for dYdX
const DYDX_WS_URL = 'wss://api.dydx.exchange/v3/ws';

/**
 * Parses an orderbook message to extract relevant data.
 * @param {Object} message - Incoming WebSocket message.
 * @returns {Object} Parsed data (best bid/ask).
 */
function parseOrderbookMessage(message) {
    if (message && message.type === 'channel_data' && message.contents) {
        const bids = message.contents.bids;
        const asks = message.contents.asks;
        return {
            market: message.contents.market,
            bestBid: bids[0] ? { price: bids[0].price, size: bids[0].size } : null,
            bestAsk: asks[0] ? { price: asks[0].price, size: asks[0].size } : null,
        };
    }
    return null;
}

/**
 * Connects to the dYdX WebSocket and subscribes to orderbook channels.
 */
async function connectToDYDX() {
    const ws = new WebSocket(DYDX_WS_URL);

    ws.on('open', () => {
        logger.info('Connected to dYdX WebSocket');

        // Subscribe to BTC-USD and ETH-USD orderbooks
        const markets = ['BTC-USD', 'ETH-USD'];
        markets.forEach((market, index) => {
            const subscriptionMessage = {
                type: 'subscribe',
                channel: 'v3_orderbook',
                id: `orderbook-${market}`, // Adjusted ID format
                market: market,
            };
            ws.send(JSON.stringify(subscriptionMessage));
            logger.info(`Subscribed to market: ${market} with id: orderbook-${market}`);
        });
    });

    ws.on('message', (data) => {
        const message = JSON.parse(data);
        if (message.type === 'channel_data') {
            const parsedData = parseOrderbookMessage(message);
            if (parsedData) {
                logger.info(`Parsed Orderbook Data: ${JSON.stringify(parsedData)}`);
            }
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
        logger.info('dYdX WebSocket connection closed');
    });
}

module.exports = { connectToDYDX, parseOrderbookMessage };
