const axios = require('axios');
const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

const redis = new Redis();

const DYDX_API_URL = 'https://api.dydx.exchange/v3/markets';
const DYDX_WS_URL = 'wss://api.dydx.exchange/v3/ws';

// Fetch active markets from dYdX API
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

// Connect to the dYdX WebSocket
function connectToDYDXWebSocket() {
    const ws = new WebSocket(DYDX_WS_URL);

    ws.on('open', () => {
        logger.info('WebSocket connected successfully.');
    });

    ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
    });

    ws.on('close', () => {
        logger.warn('WebSocket connection closed. Reconnecting...');
        setTimeout(() => connectToDYDXWebSocket(), 5000);
    });

    return ws;
}

// Subscribe to markets with WebSocket
async function subscribeToMarkets(ws, markets) {
    ws.on('open', () => {
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
        if (message.type === 'subscribed' && message.channel === 'v3_orderbook') {
            logger.info(`Subscription confirmed for market: ${message.id}`);
        } else if (message.type === 'snapshot') {
            await redis.set(`dydx:orderbook:${message.id}`, JSON.stringify(message.contents));
            logger.info(`Stored order book for market: ${message.id}`);
        } else {
            logger.info(`Unhandled message: ${JSON.stringify(message)}`);
        }
    });
}

module.exports = { fetchActiveMarkets, connectToDYDXWebSocket, subscribeToMarkets };
