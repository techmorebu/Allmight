const WebSocket = require('ws');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const redis = new Redis();

async function connectToDYDXWebSocket() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket('wss://api.dydx.exchange/v3/ws');

        ws.on('open', () => {
            logger.info('Connected to dYdX WebSocket');
            resolve(ws);
        });

        ws.on('error', (error) => {
            logger.error(`WebSocket error: ${error.message}`);
            reject(error);
        });
    });
}

async function subscribeToMarkets(ws, markets) {
    let subscriptionId = 0;

    markets.forEach((market) => {
        const message = {
            type: 'subscribe',
            channel: 'v3_orderbook',
            id: market,
            message_id: subscriptionId++,
        };

        ws.send(JSON.stringify(message));
        logger.info(`Subscribed to market: ${market}`);
    });

    ws.on('message', (data) => handleWebSocketMessage(JSON.parse(data)));
}

function handleWebSocketMessage(message) {
    if (message.type === 'subscribed' && message.channel === 'v3_orderbook') {
        const market = message.id;
        const orderBook = parseOrderBook(message.contents);
        saveOrderBookToRedis(market, orderBook);
    } else if (message.type === 'error') {
        logger.error(`WebSocket error: ${message.message}`);
    } else {
        logger.info(`Unhandled message type: ${JSON.stringify(message)}`);
    }
}

function parseOrderBook(contents) {
    const { asks, bids } = contents;
    const topAsks = asks.slice(0, 10).map((ask) => ({ price: ask.price, size: ask.size }));
    const topBids = bids.slice(0, 10).map((bid) => ({ price: bid.price, size: bid.size }));

    return {
        asks: topAsks,
        bids: topBids,
        timestamp: Date.now(),
    };
}

function saveOrderBookToRedis(market, orderBook) {
    const key = `dydx:orderbook:${market}`;
    redis.set(key, JSON.stringify(orderBook));
    logger.info(`Stored order book for ${market}`);
}

module.exports = {
    connectToDYDXWebSocket,
    subscribeToMarkets,
    parseOrderBook,
    saveOrderBookToRedis,
};
