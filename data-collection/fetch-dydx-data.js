// File: data-collection/fetch-dydx-data.js
const axios = require('axios');
const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

const redis = new Redis();

const DYDX_API_URL = 'https://api.dydx.exchange/v3/markets';
const DYDX_WS_URL = 'wss://api.dydx.exchange/v3/ws';

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

function connectToDYDXWebSocket() {
    const ws = new WebSocket(DYDX_WS_URL);
    ws.on('open', () => logger.info('Connected to dYdX WebSocket'));
    ws.on('error', (error) => logger.error(`WebSocket error: ${error.message}`));
    ws.on('close', () => logger.warn('WebSocket connection closed.'));
    return ws;
}

function mergeOrderBookUpdates(orderBook, update) {
    const updatedOrderBook = { ...orderBook };
    ['bids', 'asks'].forEach((side) => {
        update[side].forEach((updateEntry) => {
            const existingIndex = updatedOrderBook[side].findIndex(
                (entry) => entry.price === updateEntry.price
            );

            if (existingIndex >= 0) {
                if (updateEntry.size === '0') {
                    updatedOrderBook[side].splice(existingIndex, 1);
                } else {
                    updatedOrderBook[side][existingIndex].size = updateEntry.size;
                }
            } else if (updateEntry.size !== '0') {
                updatedOrderBook[side].push(updateEntry);
            }
        });

        updatedOrderBook[side].sort((a, b) =>
            side === 'bids' ? b.price - a.price : a.price - b.price
        );
    });

    return updatedOrderBook;
}

async function subscribeToMarkets(ws, markets) {
    const orderBooks = {};
    markets.forEach((market) => {
        const subscriptionMessage = {
            type: 'subscribe',
            channel: 'v3_orderbook',
            id: market,
        };
        ws.send(JSON.stringify(subscriptionMessage));
        logger.info(`Subscribed to market: ${market}`);
        orderBooks[market] = { bids: [], asks: [] }; // Initialize empty order book
    });

    ws.on('message', async (data) => {
        const message = JSON.parse(data);

        if (message.type === 'snapshot') {
            const market = message.id;
            await redis.set(`dydx:orderbook:${market}`, JSON.stringify(message.contents));
            orderBooks[market] = message.contents;
            logger.info(`Stored order book snapshot for ${market}`);
        } else if (message.type === 'update') {
            const market = message.id;
            const existingOrderBook = orderBooks[market];
            const updatedOrderBook = mergeOrderBookUpdates(existingOrderBook, message.contents);
            await redis.set(`dydx:orderbook:${market}`, JSON.stringify(updatedOrderBook));
            orderBooks[market] = updatedOrderBook;
            logger.info(`Updated and stored order book for ${market}`);
        } else {
            logger.info(`Unhandled message: ${JSON.stringify(message)}`);
        }
    });
}

module.exports = {
    fetchActiveMarkets,
    connectToDYDXWebSocket,
    subscribeToMarkets,
    mergeOrderBookUpdates,
};
