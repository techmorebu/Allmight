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

    ws.on('message', async (data) => {
        const message = JSON.parse(data);
        if (message.type === 'subscribed' && message.channel === 'v3_orderbook') {
            logger.info(`Subscription confirmed for market: ${message.id}`);
        } else if (message.type === 'snapshot' || message.type === 'update') {
            const parsedOrderBook = {
                market: message.id,
                bids: message.contents.bids.map((bid) => ({
                    price: parseFloat(bid.price),
                    size: parseFloat(bid.size),
                })),
                asks: message.contents.asks.map((ask) => ({
                    price: parseFloat(ask.price),
                    size: parseFloat(ask.size),
                })),
                timestamp: new Date().toISOString(),
            };
            await redis.set(`dydx:orderbook:${message.id}`, JSON.stringify(parsedOrderBook));
            logger.info(`Stored parsed order book for ${message.id}`);
        } else {
            logger.info(`Unhandled message type: ${JSON.stringify(message)}`);
        }
    });
}

module.exports = { fetchActiveMarkets, connectToDYDXWebSocket, subscribeToMarkets };
