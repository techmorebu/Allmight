const WebSocket = require('ws');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

// Initialize Redis client
const redis = new Redis();

redis.on('error', (err) => logger.error(`Redis error: ${err.message}`));
redis.on('connect', () => logger.info('Connected to Redis'));

async function connectToDYDXWebSocket() {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket('wss://api.dydx.exchange/v3/ws');

        socket.on('open', () => {
            logger.info('Connected to dYdX WebSocket');
            resolve(socket);
        });

        socket.on('error', (err) => {
            logger.error(`WebSocket error: ${err.message}`);
            reject(err);
        });
    });
}

async function subscribeToMarkets(socket, markets) {
    for (const market of markets) {
        const message = {
            type: 'subscribe',
            channel: 'v3_orderbook',
            id: market,
        };
        socket.send(JSON.stringify(message));
        logger.info(`Subscribed to market: ${market}`);
    }
}

function handleWebSocketMessages(socket) {
    socket.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            if (message.type === 'orderbook_update') {
                const market = message.market;
                const orderbook = {
                    bestBid: message.bestBid,
                    bestAsk: message.bestAsk,
                };

                // Store the orderbook in Redis
                await redis.set(`${market}:orderbook`, JSON.stringify(orderbook));
                logger.info(`Stored order book for ${market}`);
            } else {
                logger.info(`Unhandled message type: ${JSON.stringify(message)}`);
            }
        } catch (err) {
            logger.error(`Error processing WebSocket message: ${err.message}`);
        }
    });
}

module.exports = { connectToDYDXWebSocket, subscribeToMarkets, handleWebSocketMessages };
