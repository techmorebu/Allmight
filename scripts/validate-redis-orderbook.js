// File: scripts/validate-redis-orderbook.js
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

(async () => {
    const redis = new Redis();

    try {
        logger.info('Starting Redis validation script...');
        const markets = ['ZEC-USD', 'EOS-USD'];
        for (const market of markets) {
            const data = await redis.get(`dydx:orderbook:${market}`);
            logger.info(`Order Book for ${market}: ${data ? JSON.stringify(JSON.parse(data), null, 2) : 'No data found'}`);
        }
        redis.disconnect();
    } catch (error) {
        logger.error(`Error validating Redis data: ${error.message}`);
        redis.disconnect();
    }
})();
