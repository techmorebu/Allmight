const WebSocket = require('ws');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const DYDX_WS_URL = 'wss://api.dydx.exchange/v3/ws';
const MARKETS = ['BTC-USD', 'ETH-USD']; // Add more markets as needed

const redis = new Redis(); // Redis client for caching data

let ws; // WebSocket instance

/**
 * Connect to dYdX WebSocket
 */
function connectToDYDX() {
    ws = new WebSocket(DYDX_WS_URL);

    ws.on('open', () => {
        logger.info('Connected to dYdX WebSocket');
        MARKETS.forEach((market) => subscribeToMarket(market));
    });

    ws.on('message', (data) => {
        const message = JSON.parse(data);
        handleWebSocketMessage(message);
    });

    ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
    });

    ws.on('close', () => {
        logger.warn('WebSocket connection closed. Reconnecting...');
        setTimeout(connectToDYDX, 5000); // Reconnect after 5 seconds
    });
}

/**
 * Subscribe to a specific market
 * @param {string} market - The market to subscribe to (e.g., BTC-USD)
 */
function subscribeToMarket(market) {
    const subscriptionMessage = {
        type: 'subscribe',
        channel: 'v3_orderbook',
        id: market,
    };
    ws.send(JSON.stringify(subscriptionMessage));
    logger.info(`Subscribed to market: ${market}`);
}

/**
 * Handle incoming WebSocket messages
 * @param {object} message - The WebSocket message
 */
function handleWebSocketMessage(message) {
    if (message.type === 'channel_data' && message.channel === 'v3_orderbook') {
        const { id: market, contents } = message;
        parseAndCacheOrderbook(market, contents);
    } else if (message.type === 'error') {
        logger.error(`Error from dYdX: ${message.message} (Details: ${JSON.stringify(message)})`);
    } else {
        logger.info(`Unhandled message type: ${JSON.stringify(message)}`);
    }
}

/**
 * Parse and cache orderbook data
 * @param {string} market - The market ID (e.g., BTC-USD)
 * @param {object} contents - The orderbook contents
 */
function parseAndCacheOrderbook(market, contents) {
    const bestBid = contents.bids[0];
    const bestAsk = contents.asks[0];
    const parsedData = {
        market,
        bestBid: { price: bestBid[0], size: bestBid[1] },
        bestAsk: { price: bestAsk[0], size: bestAsk[1] },
    };

    redis.set(`dydx:orderbook:${market}`, JSON.stringify(parsedData));
    logger.info(`Cached orderbook for ${market}: ${JSON.stringify(parsedData)}`);
}

module.exports = { connectToDYDX };
