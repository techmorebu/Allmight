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

function parseOrderBook(rawOrderBook, market, maxLevels = 5) {
    const parsed = {
        market,
        bids: rawOrderBook.bids.slice(0, maxLevels).map(level => ({
            price: parseFloat(level.price),
            size: parseFloat(level.size),
        })),
        asks: rawOrderBook.asks.slice(0, maxLevels).map(level => ({
            price: parseFloat(level.price),
            size: parseFloat(level.size),
        })),
        timestamp: Date.now(),
    };
    logger.info(`Parsed order book for ${market}: ${JSON.stringify(parsed)}`);
    return parsed;
}

async function handleMessage(message, ws) {
    if (message.type === 'snapshot' || message.type === 'update') {
        const parsedData = parseOrderBook(message.contents, message.id, 10);
        await redis.set(`dydx:orderbook:${message.id}`, JSON.stringify(parsedData));
        logger.info(`Stored optimized order book for ${message.id}`);
    } else {
        logger.info(`Unhandled message: ${JSON.stringify(message)}`);
    }
}

async function subscribeToMarkets(ws, markets) {
    ws.on('open', () => {
        logger.info('WebSocket connection is open. Proceeding with subscriptions.');
        markets.forEach((market) => {
            const subscriptionMessage = {
                type: 'subscribe',
                channel: 'v3_orderbook',
                id: market,
            };
            ws.send(JSON.stringify(subscriptionMessage));
            logger.info(`Subscribed to market: ${market}`);
        });
    });

    ws.on('message', async (data) => {
        const message = JSON.parse(data);
        await handleMessage(message, ws);
    });

    ws.on('error', (error) => logger.error(`WebSocket error: ${error.message}`));
}


module.exports = { fetchActiveMarkets, connectToDYDXWebSocket, subscribeToMarkets };
