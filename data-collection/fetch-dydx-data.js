const WebSocket = require('ws');
const { createClient } = require('redis');
const { logger } = require('../monitoring/logger');

const REDIS_KEY = 'dydx_raw_data';

async function startFetcher() {
    const redisClient = createClient();
    await redisClient.connect();

    const ws = new WebSocket('wss://api.dydx.exchange/v3/ws');

    ws.on('open', () => {
        logger.info('Connected to dYdX WebSocket');
        // Subscribe to orderbook channels
        const subscriptionMessage = JSON.stringify({
            type: 'subscribe',
            channel: 'v3_orderbook',
            markets: ['BTC-USD', 'ETH-USD'], // Add more markets as needed
        });
        ws.send(subscriptionMessage);
    });

    ws.on('message', async (message) => {
        const data = JSON.parse(message);

        // Store raw data in Redis
        await redisClient.rPush(REDIS_KEY, JSON.stringify(data));

        logger.info(`Stored Raw Message: ${data.type || 'unknown'}`);
    });

    ws.on('error', (error) => {
        logger.error(`WebSocket Error: ${error.message}`);
    });

    ws.on('close', () => {
        logger.warn('WebSocket closed. Reconnecting...');
        startFetcher();
    });
}

startFetcher();
