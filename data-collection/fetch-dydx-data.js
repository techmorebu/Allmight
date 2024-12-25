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

function connectToDYDXWebSocket() {
    const ws = new WebSocket('wss://api.dydx.exchange/v3/ws');
    return new Promise((resolve, reject) => {
        ws.on('open', () => {
            logger.info('Connected to dYdX WebSocket');
            resolve(ws);
        });
        ws.on('error', (error) => {
            logger.error(`WebSocket error: ${error.message}`);
            reject(error);
        });
        ws.on('close', () => logger.warn('WebSocket connection closed.'));
    });
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

        switch (message.type) {
            case 'connected':
                logger.info(`WebSocket connected with ID: ${message.connection_id}`);
                break;
            case 'subscribed':
                if (message.channel === 'v3_orderbook') {
                    logger.info(`Subscription confirmed for market: ${message.id}`);
                }
                break;
            case 'snapshot':
                await redis.set(`dydx:orderbook:${message.id}`, JSON.stringify(message.contents));
                logger.info(`Stored order book for ${message.id}`);
                break;
            case 'update':
                await redis.set(`dydx:orderbook:${message.id}`, JSON.stringify(message.contents));
                logger.info(`Updated order book for ${message.id}`);
                break;
            default:
                // Log unhandled messages at a lower log level
                logger.debug(`Unhandled message: ${JSON.stringify(message)}`);
                break;
        }
    });
}


module.exports = { fetchActiveMarkets, connectToDYDXWebSocket, subscribeToMarkets };
