const WebSocket = require('ws');
const Redis = require('ioredis');
const { logger } = require('../utils/logger');
const axios = require('axios');
require('dotenv').config();

const DYDX_API_URL = process.env.DYDX_API_URL || 'https://api.dydx.exchange/v3/markets';
const WEBSOCKET_URL = process.env.DYDX_WEBSOCKET_URL || 'wss://api.dydx.exchange/v3/ws';
const redis = new Redis();

const MAX_ORDERBOOK_LEVELS = 10; // Limit order book depth for optimization
const ALERT_THRESHOLD = 0.05; // 5% price change for alerts

let socket;

const parseOrderBook = (orderBook) => {
    const topAsks = orderBook.asks.slice(0, MAX_ORDERBOOK_LEVELS);
    const topBids = orderBook.bids.slice(0, MAX_ORDERBOOK_LEVELS);

    return {
        asks: topAsks,
        bids: topBids,
        timestamp: Date.now(),
    };
};

const monitorSignificantChanges = (market, newOrderBook, prevOrderBook) => {
    if (!prevOrderBook) return;

    const prevBestAsk = prevOrderBook.asks[0]?.price || 0;
    const prevBestBid = prevOrderBook.bids[0]?.price || 0;
    const newBestAsk = newOrderBook.asks[0]?.price || 0;
    const newBestBid = newOrderBook.bids[0]?.price || 0;

    const askChange = Math.abs((newBestAsk - prevBestAsk) / prevBestAsk);
    const bidChange = Math.abs((newBestBid - prevBestBid) / prevBestBid);

    if (askChange > ALERT_THRESHOLD || bidChange > ALERT_THRESHOLD) {
        logger.warn(`Significant price change detected for ${market}: Ask: ${askChange * 100}%, Bid: ${bidChange * 100}%`);
    }
};

const fetchMarkets = async () => {
    try {
        const response = await axios.get(DYDX_API_URL);
        const markets = Object.keys(response.data.markets);
        logger.info(`Fetched active markets: ${markets.join(', ')}`);
        return markets;
    } catch (error) {
        logger.error('Error fetching markets:', error);
        return [];
    }
};

const connectToDYDXWebSocket = async () => {
    const markets = await fetchMarkets();
    if (!markets.length) return;

    socket = new WebSocket(WEBSOCKET_URL);

    socket.on('open', () => {
        logger.info('Connected to dYdX WebSocket');
        markets.forEach((market, index) => {
            const subscriptionMessage = JSON.stringify({
                type: 'subscribe',
                channel: 'v3_orderbook',
                id: market,
            });
            socket.send(subscriptionMessage);
            logger.info(`Subscribed to market: ${market}`);
        });
    });

    socket.on('message', async (data) => {
        const message = JSON.parse(data);
        if (message.type === 'subscribed' && message.channel === 'v3_orderbook') {
            logger.info(`Subscription confirmed for channel: ${message.channel}, market: ${message.id}`);
        } else if (message.type === 'v3_orderbook') {
            const market = message.id;
            const parsedData = parseOrderBook(message.contents);
            const prevOrderBook = await redis.get(`orderbook:${market}`);
            monitorSignificantChanges(market, parsedData, JSON.parse(prevOrderBook));
            await redis.set(`orderbook:${market}`, JSON.stringify(parsedData));
            logger.info(`Stored order book for ${market}`);
        }
    });

    socket.on('close', () => {
        logger.error('WebSocket connection closed. Reconnecting...');
        setTimeout(connectToDYDXWebSocket, 5000);
    });

    socket.on('error', (err) => {
        logger.error('WebSocket error:', err);
    });
};

module.exports = { connectToDYDXWebSocket };
