const { createClient } = require('redis');
const { logger } = require('../monitoring/logger');

const REDIS_KEY = 'dydx_raw_data';

async function parseRawData() {
    const redisClient = createClient();
    await redisClient.connect();

    while (true) {
        // Fetch raw data
        const rawMessage = await redisClient.lPop(REDIS_KEY);
        if (!rawMessage) break;

        const parsedData = parseMessage(JSON.parse(rawMessage));
        if (parsedData) {
            logger.info(`Parsed Data: ${JSON.stringify(parsedData)}`);
        }
    }

    await redisClient.disconnect();
}

function parseMessage(message) {
    if (message.type === 'orderbook') {
        return {
            type: 'orderbook',
            market: message.market,
            bestBid: message.bids[0],
            bestAsk: message.asks[0],
        };
    } else if (message.type === 'trade') {
        return {
            type: 'trade',
            market: message.market,
            tradePrice: message.price,
            tradeSize: message.size,
        };
    }
    return null; // Skip unknown message types
}

parseRawData();
