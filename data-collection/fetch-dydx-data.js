const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

// Initialize Redis client for caching real-time data
const redis = new Redis();

const DYDX_WEBSOCKET_URL = 'wss://api.dydx.exchange/v3/ws';

function connectToDYDX() {
    const ws = new WebSocket(DYDX_WEBSOCKET_URL);

    ws.on('open', () => {
        logger.info('Connected to dYdX WebSocket');
        // Subscribe to the order book of relevant markets
        const markets = ['BTC-USD', 'ETH-USD']; // Add other markets relevant to Allmight
        markets.forEach((market) => {
            const subscriptionMessage = {
                type: 'subscribe',
                channel: 'v3_orderbook',
                id: market,
            };
            ws.send(JSON.stringify(subscriptionMessage));
            logger.info(`Subscribed to market: ${market}`);
        });
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'subscribed') {
                logger.info(`Subscription confirmed for channel: ${data.channel}, market: ${data.id}`);
            } else if (data.type === 'channel_data' && data.channel === 'v3_orderbook') {
                const { asks, bids } = data.contents;
                if (asks.length > 0 && bids.length > 0) {
                    const market = data.id;

                    // Extract top ask and bid prices
                    const topAsk = { price: parseFloat(asks[0][0]), size: parseFloat(asks[0][1]) };
                    const topBid = { price: parseFloat(bids[0][0]), size: parseFloat(bids[0][1]) };

                    // Log data for debugging
                    logger.info(`Market: ${market}, Top Ask: ${topAsk.price} @ ${topAsk.size}, Top Bid: ${topBid.price} @ ${topBid.size}`);

                    // Save data to Redis for arbitrage analysis
                    redis.hset(`dydx:${market}`, {
                        topAskPrice: topAsk.price,
                        topAskSize: topAsk.size,
                        topBidPrice: topBid.price,
                        topBidSize: topBid.size,
                        timestamp: Date.now(),
                    });

                    // Emit event or push to further processing pipeline if required
                } else {
                    logger.warn(`Empty order book data for market: ${data.id}`);
                }
            } else {
                logger.info(`Unhandled message type: ${JSON.stringify(data)}`);
            }
        } catch (error) {
            logger.error(`Error processing WebSocket message: ${error.message}`);
        }
    });

    ws.on('close', () => {
        logger.warn('Disconnected from dYdX WebSocket. Reconnecting...');
        setTimeout(connectToDYDX, 5000); // Reconnect after 5 seconds
    });

    ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
    });
}

// Start WebSocket connection
connectToDYDX();
