const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');

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

module.exports = { connectToDYDXWebSocket, subscribeToMarkets };
