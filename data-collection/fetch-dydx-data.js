// Required libraries
const WebSocket = require('ws');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const DYDX_WS_URL = process.env.DYDX_WS_URL;
const redis = new Redis(); // Connects to Redis

// Connect to dYdX WebSocket
async function connectToDYDX() {
    const ws = new WebSocket(DYDX_WS_URL);

    ws.on('open', () => {
        logger.info('Connected to dYdX WebSocket');

        // Subscribe to markets
        const markets = ['BTC-USD', 'ETH-USD'];
        markets.forEach((market, index) => {
            const subscription = {
                type: 'subscribe',
                channel: 'v3_orderbook',
                id: market,
                includeOffsets: true,
            };
            ws.send(JSON.stringify(subscription));
            logger.info(`Subscribed to market: ${market}`);
        });
    });

    ws.on('message', (data) => {
        const message = JSON.parse(data);

        // Handle subscription confirmation
        if (message.type === 'subscribed') {
            logger.info(`Subscription confirmed for channel: ${message.channel}, market: ${message.id}`);
        }

        // Handle order book updates
        if (message.type === 'orderbook') {
            const parsedData = parseOrderBookData(message);
            storeDataToRedis(parsedData);
        }

        // Handle errors
        if (message.type === 'error') {
            logger.error(`Error from dYdX: ${message.message} (Details: ${JSON.stringify(message)})`);
        }
    });

    ws.on('close', () => {
        logger.error('WebSocket connection closed. Reconnecting...');
        setTimeout(connectToDYDX, 5000);
    });

    ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
    });
}

// Parse order book data
function parseOrderBookData(message) {
    const market = message.id;
    const bestBid = message.bids ? message.bids[0] : null;
    const bestAsk = message.asks ? message.asks[0] : null;

    return {
        market,
        bestBid: bestBid ? { price: bestBid[0], size: bestBid[1] } : null,
        bestAsk: bestAsk ? { price: bestAsk[0], size: bestAsk[1] } : null,
    };
}

// Store parsed data to Redis
function storeDataToRedis(parsedData) {
    const { market, bestBid, bestAsk } = parsedData;
    const key = `dydx:${market}:orderbook`;

    const value = {
        bestBid,
        bestAsk,
        timestamp: new Date().toISOString(),
    };

    redis.set(key, JSON.stringify(value), 'EX', 10); // Data expires in 10 seconds
    logger.info(`Stored parsed data for market ${market} to Redis: ${JSON.stringify(value)}`);
}

module.exports = { connectToDYDX };
