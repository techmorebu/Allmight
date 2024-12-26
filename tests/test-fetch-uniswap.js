const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

(async () => {
    const redis = new Redis();

    try {
        logger.info('Starting Redis validation for Uniswap data...');

        // Validate Pool Data
        const poolKeys = await redis.keys('uniswap:pool:*');
        if (poolKeys.length === 0) {
            logger.error('No pool data found in Redis.');
        } else {
            logger.info(`Found ${poolKeys.length} pools in Redis.`);
            for (const poolKey of poolKeys) {
                const poolData = await redis.get(poolKey);
                const parsedPool = JSON.parse(poolData);
                if (parsedPool.id && parsedPool.totalValueLockedUSD) {
                    logger.info(`Validated pool: ${parsedPool.id}`);
                } else {
                    logger.warn(`Invalid data for pool: ${poolKey}`);
                }
            }
        }

        // Validate Token Historical Data
        const tokenKeys = await redis.keys('uniswap:token:*:historical');
        if (tokenKeys.length === 0) {
            logger.error('No historical token data found in Redis.');
        } else {
            logger.info(`Found historical data for ${tokenKeys.length} tokens in Redis.`);
            for (const tokenKey of tokenKeys) {
                const tokenData = await redis.get(tokenKey);
                const parsedTokenData = JSON.parse(tokenData);

                if (Array.isArray(parsedTokenData) && parsedTokenData.length > 0) {
                    logger.info(
                        `Validated historical data for token: ${tokenKey.split(':')[2]}`
                    );
                } else {
                    logger.warn(
                        `Invalid or empty historical data for token: ${tokenKey.split(':')[2]}`
                    );
                }
            }
        }
    } catch (error) {
        logger.error(`Error during validation: ${error.message}`);
    } finally {
        redis.disconnect();
        logger.info('Redis validation test completed.');
    }
})();
