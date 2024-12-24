const WebSocket = require('ws');
const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const DYDX_WS_URL = 'wss://api.dydx.exchange/v3/ws';
const DYDX_REST_URL = 'https://api.dydx.exchange/v3/markets';

const redis = new Redis(); // Default Redis instance
const MARKETS_TO_SUBSCRIBE = []; // Will be dynamically populated

async function fetchMarkets() {
    try {
        const response = await axios.get(DYDX_REST_URL);
        if (response.data && response.data.markets) {
            return Object.keys(response.data.markets);
        }
        throw new Error('No markets found in the API response.');
    } catch (error) {
        logger.error(`Error fetching markets: ${error.message}`);
        throw error;
    }
}

function connectToDYDX(markets) {
    const ws = new WebSocket(DYDX_WS_URL);

    ws.on('open', () => {
        logger.info('Connected to dYdX WebSocket');
        markets.forEach(market => {
            ws.send(JSON.stringify({
                type: 'subscribe',
                channel: 'v3_orderbook',
                id: market
            }));
            logger.info(`Subscribed to market: ${market}`);
        });
    });

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);

            if (message.type === 'subscribed') {
                logger.info(`Subscription confirmed for channel: ${message.channel}, market: ${message.id}`);
            } else if (message.type === 'channel_data' && message.channel === 'v3_orderbook') {
                const { bids, asks } = message.contents;
                const market = message.id;

                if (bids && asks) {
                    const bestBid = bids[0][0]; // Price of the highest bid
                    const bestAsk = asks[0][0]; // Price of the lowest ask

                    // Store in Redis
                    await redis.set(`dydx:${market}:bid`, bestBid);
                    await redis.set(`dydx:${market}:ask`, bestAsk);

                    logger.info(`Updated Redis for market: ${market}, Bid: ${bestBid}, Ask: ${bestAsk}`);
                }
            } else {
                logger.info(`Unhandled message type: ${data}`);
            }
        } catch (error) {
            logger.error(`Error processing WebSocket message: ${error.message}`);
        }
    });

    ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
    });

    ws.on('close', () => {
        logger.error('WebSocket connection closed. Attempting to reconnect...');
        setTimeout(() => connectToDYDX(markets), 5000); // Reconnect after 5 seconds
    });
}

(async () => {
    try {
        const markets = await fetchMarkets();
        MARKETS_TO_SUBSCRIBE.push(...markets);

        logger.info(`Markets to subscribe: ${MARKETS_TO_SUBSCRIBE.join(', ')}`);
        connectToDYDX(MARKETS_TO_SUBSCRIBE);
    } catch (error) {
        logger.error(`Failed to initialize dYdX WebSocket fetcher: ${error.message}`);
    }
})();
