const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

(async () => {
    try {
        logger.info('Starting Redis validation for Uniswap data...');
        const redis = new Redis();

        // Validate pool data
        const poolKeys = await redis.keys('uniswap:pool:*');
        for (const key of poolKeys) {
            const poolData = JSON.parse(await redis.get(key));
            if (poolData && poolData.id && poolData.totalValueLockedUSD) {
                logger.info(`Validated pool: ${poolData.id}`);
            } else {
                logger.error(`Invalid or missing data for pool: ${key}`);
            }
        }

        // Validate historical token data
        const tokenKeys = await redis.keys('uniswap:token:*');
        if (tokenKeys.length === 0) {
            logger.error('No token historical data found in Redis.');
        } else {
            for (const key of tokenKeys) {
                const tokenData = JSON.parse(await redis.get(key));
                if (Array.isArray(tokenData) && tokenData.length > 0) {
                    logger.info(`Validated token data: ${key}`);
                } else {
                    logger.error(`Invalid or missing data for token: ${key}`);
                }
            }
        }

        redis.disconnect();
    } catch (error) {
        logger.error(`Validation failed: ${error.message}`);
    }
})();
