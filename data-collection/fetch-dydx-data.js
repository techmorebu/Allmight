const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const DYDX_WEBSOCKET_URL = process.env.DYDX_WEBSOCKET_URL;

function connectToDYDX() {
    const ws = new WebSocket(DYDX_WEBSOCKET_URL);

    ws.on('open', () => {
        logger.info('Connected to dYdX WebSocket');
        subscribeToMarkets(ws, ['BTC-USD', 'ETH-USD']);
    });

    ws.on('message', (message) => {
        handleMessage(JSON.parse(message));
    });

    ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
    });

    ws.on('close', () => {
        logger.warn('WebSocket connection closed');
    });
}

function subscribeToMarkets(ws, markets) {
    markets.forEach((market) => {
        const subscriptionMessage = {
            type: 'subscribe',
            channel: 'v3_orderbook',
            market,
        };
        ws.send(JSON.stringify(subscriptionMessage));
        logger.info(`Subscribed to market: ${market}`);
    });
}

function handleMessage(data) {
    if (data.type === 'subscribed') {
        logger.info(`Subscription confirmed for channel: ${data.channel}, market: ${data.market}`);
    } else if (data.type === 'snapshot' || data.type === 'update') {
        const parsedData = parseOrderbook(data);
        logger.info(`Parsed Data: ${JSON.stringify(parsedData)}`);
    } else if (data.type === 'error') {
        logger.error(`Error from dYdX: ${data.message} (Details: ${JSON.stringify(data)})`);
    } else {
        logger.info(`Unhandled message type: ${JSON.stringify(data)}`);
    }
}

function parseOrderbook(data) {
    const market = data.market;
    const bestBid = data.bids[0];
    const bestAsk = data.asks[0];

    return {
        market,
        bestBid: {
            price: bestBid[0],
            size: bestBid[1],
        },
        bestAsk: {
            price: bestAsk[0],
            size: bestAsk[1],
        },
    };
}

module.exports = { connectToDYDX };
