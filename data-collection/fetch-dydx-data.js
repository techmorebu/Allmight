const axios = require('axios');
const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

const redis = new Redis();

const DYDX_API_URL = 'https://api.dydx.exchange/v3/markets';
const DYDX_WS_URL = 'wss://api.dydx.exchange/v3/ws';

/**
 * Fetch the active markets from dYdX REST API.
 */
async function fetchActiveMarkets() {
    try {
        const response = await axios.get(DYDX_API_URL);
        const markets = Object.keys(response.data.markets);
        logger.info(`Fetched ${markets.length} active markets.`);
        return markets;
    } catch (error) {
        logger.error(`Failed to fetch active markets: ${error.message}`);
        throw error;
    }
}

/**
 * Connect to the dYdX WebSocket server.
 */
function connectToDYDXWebSocket() {
    const ws = new WebSocket(DYDX_WS_URL);

    ws.on('open', () => logger.info('Connected to dYdX WebSocket'));

    ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
        setTimeout(() => connectToDYDXWebSocket(), 5000); // Retry connection
    });

    ws.on('close', (code, reason) => {
        logger.warn(`WebSocket closed: Code ${code}, Reason ${reason}`);
        setTimeout(() => connectToDYDXWebSocket(), 5000); // Retry connection
    });

    return ws;
}

/**
 * Subscribe to order book channels for specified markets.
 */
async function subscribeToMarkets(ws, markets) {
    markets.forEach((market) => {
        const subscriptionMessage = {
            type: 'subscribe',
            channel: 'v3_orderbook',
            id: market,
        };
        ws.send(JSON.stringify(subscriptionMessage));
        logger.info(`Subscribed to market: ${market}`);
    });

    await handleWebSocketMessage(ws);
}

/**
 * Handle WebSocket messages and parse order book data.
 */
async function handleWebSocketMessage(ws) {
    ws.on('message', async (data) => {
        const message = JSON.parse(data);

        switch (message.type) {
            case 'connected':
                logger.info(`WebSocket connected with ID: ${message.connection_id}`);
                break;

            case 'subscribed':
                logger.info(`Subscription confirmed for market: ${message.id}`);
                break;

            case 'snapshot':
                await redis.set(`dydx:orderbook:${message.id}`, JSON.stringify(message.contents));
                logger.info(`Stored initial snapshot for ${message.id}`);
                break;

            case 'update':
                const currentOrderBook = await redis.get(`dydx:orderbook:${message.id}`);
                if (currentOrderBook) {
                    const updatedOrderBook = mergeOrderBookUpdates(JSON.parse(currentOrderBook), message.contents);
                    await redis.set(`dydx:orderbook:${message.id}`, JSON.stringify(updatedOrderBook));
                    logger.info(`Updated order book for ${message.id}`);
                } else {
                    logger.warn(`No snapshot found for ${message.id}. Storing update as snapshot.`);
                    await redis.set(`dydx:orderbook:${message.id}`, JSON.stringify(message.contents));
                }
                break;

            default:
                logger.debug(`Unhandled message type: ${JSON.stringify(message)}`);
        }
    });
}

/**
 * Merge updates into the current order book.
 */
function mergeOrderBookUpdates(currentOrderBook, updates) {
    const updatedAsks = mergePriceLevels(currentOrderBook.asks, updates.asks);
    const updatedBids = mergePriceLevels(currentOrderBook.bids, updates.bids);

    return {
        ...currentOrderBook,
        asks: updatedAsks,
        bids: updatedBids,
    };
}

/**
 * Merge price levels for asks or bids.
 */
function mergePriceLevels(existingLevels, newLevels) {
    const levelMap = new Map();

    // Add existing levels
    existingLevels.forEach((level) => levelMap.set(level.price, level.size));

    // Apply updates
    newLevels.forEach((level) => {
        if (level.size === '0') {
            levelMap.delete(level.price); // Remove levels with size 0
        } else {
            levelMap.set(level.price, level.size); // Update or add new levels
        }
    });

    // Convert back to array and sort
    return Array.from(levelMap.entries())
        .map(([price, size]) => ({ price, size }))
        .sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
}

module.exports = { 
    fetchActiveMarkets, 
    connectToDYDXWebSocket, 
    subscribeToMarkets, 
    mergeOrderBookUpdates};
