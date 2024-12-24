const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');

let ws;

async function connectToDYDX() {
    return new Promise((resolve, reject) => {
        ws = new WebSocket('wss://api.dydx.exchange/v3/ws');

        ws.on('open', () => {
            logger.info('Connected to dYdX WebSocket');
            resolve(ws);
        });

        ws.on('error', (err) => {
            logger.error(`Error connecting to dYdX WebSocket: ${err.message}`);
            reject(err);
        });
    });
}

function subscribeToMarket(ws, market) {
    const message = {
        type: 'subscribe',
        channel: 'v3_orderbook',
        id: market,
    };
    ws.send(JSON.stringify(message));
    logger.info(`Subscribed to market: ${market}`);
}

function processMessage(message) {
    const parsedMessage = JSON.parse(message);
    logger.info(`Stored Raw Message: ${parsedMessage.type}`);
}

function startFetcher(markets) {
    if (!ws) {
        logger.error('WebSocket connection not established.');
        return;
    }

    markets.forEach((market) => {
        subscribeToMarket(ws, market);
    });

    ws.on('message', (message) => {
        processMessage(message);
    });
}

module.exports = {
    connectToDYDX,
    startFetcher,
};
