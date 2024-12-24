const WebSocket = require('ws');
const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const DYDX_WS_URL = 'wss://api.dydx.exchange/v3/ws';
const DYDX_API_URL = 'https://api.dydx.exchange/v3/markets';
const redis = new Redis();

let ws;

async function fetchActiveMarkets() {
    try {
        logger.info('Fetching active markets from dYdX...');
        const response = await axios.get(DYDX_API_URL);
        const markets = response.data.markets || {};
        logger.info(`Fetched ${Object.keys(markets).length} active markets.`);
        return Object.keys(markets);
    } catch (error) {
        logger.error(`Error fetching active markets: ${error.message}`);
        return [];
    }
}

function connectToDYDXWebSocket() {
    return new Promise((resolve, reject) => {
        logger.info('Connecting to dYdX WebSocket...');
        ws = new WebSocket(DYDX_WS_URL);

        ws.on('open', () => {
            logger.info('Connected to dYdX WebSocket');
            resolve();
        });

        ws.on('error', (error) => {
            logger.error(`WebSocket error: ${error.message}`);
            reject(error);
        });

        ws.on('close', () => {
            logger.warn('WebSocket connection closed.');
        });

        ws.on('message', (data) => {
            const message = JSON.parse(data);
            handleWebSocketMessage(message);
        });
    });
}

function subscribeToMarketOrderBooks(markets) {
    markets.forEach((market, index) => {
        const subscriptionMessage = {
            type: 'subscribe',
            channel: 'v3_orderbook',
            id: market,
        };
        ws.send(JSON.stringify(subscriptionMessage));
        logger.info(`Subscribed to market: ${market}`);
    });
}

function handleWebSocketMessage(message) {
    if (message.type === 'subscribed') {
        logger.info(`Subscription confirmed for market: ${message.id}`);
    } else if (message.type === 'v3_orderbook_snapshot') {
        const { id: market, contents } = message;
        redis.set(`orderbook:${market}`, JSON.stringify(contents));
        logger.info(`Stored order book for ${market}`);
    } else {
        logger.info(`Unhandled message type: ${JSON.stringify(message)}`);
    }
}

async function startFetcher() {
    try {
        const markets = await fetchActiveMarkets();
        if (markets.length === 0) {
            logger.warn('No active markets available.');
            return;
        }

        await connectToDYDXWebSocket();
        subscribeToMarketOrderBooks(markets);
    } catch (error) {
        logger.error(`Error in fetcher: ${error.message}`);
    }
}

module.exports = { startFetcher, fetchActiveMarkets };
