// File: data-collection/fetch-dydx-data.js
const axios = require('axios');
const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

const redis = new Redis();

const DYDX_API_URL = 'https://api.dydx.exchange/v3/markets';

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

function waitForWebSocketOpen(websocket) {
    return new Promise((resolve, reject) => {
        const interval = setInterval(() => {
            if (websocket.readyState === WebSocket.OPEN) {
                clearInterval(interval);
                resolve();
            }
        }, 50); // Check every 50ms

        setTimeout(() => {
            clearInterval(interval);
            reject(new Error('WebSocket connection timed out.'));
        }, 5000); // Timeout after 5 seconds
    });
}

async function connectToDYDXWebSocket() {
    const websocket = new WebSocket(DYDX_WS_URL);

    websocket.onopen = () => logger.info('Connected to dYdX WebSocket');
    websocket.onerror = (error) => logger.error(`WebSocket error: ${error.message}`);
    websocket.onclose = () => logger.info('WebSocket connection closed');

    await waitForWebSocketOpen(websocket); // Wait for WebSocket to fully open

    return websocket;
}

async function subscribeToMarkets(ws, markets) {
    markets.forEach((market, index) => {
        const subscriptionMessage = {
            type: 'subscribe',
            channel: 'v3_orderbook',
            id: market,
        };
        ws.send(JSON.stringify(subscriptionMessage));
        logger.info(`Subscribed to market: ${market}`);
    });

    ws.on('message', async (data) => {
        const message = JSON.parse(data);
        if (message.type === 'subscribed' && message.channel === 'v3_orderbook') {
            logger.info(`Subscription confirmed for channel: ${message.channel}, market: ${message.id}`);
        } else if (message.type === 'snapshot') {
            await redis.set(`dydx:orderbook:${message.id}`, JSON.stringify(message.contents));
            logger.info(`Stored order book for ${message.id}`);
        } else {
            logger.info(`Unhandled message type: ${JSON.stringify(message)}`);
        }
    });
}

module.exports = { fetchActiveMarkets, connectToDYDXWebSocket, subscribeToMarkets };
