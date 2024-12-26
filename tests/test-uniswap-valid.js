const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

(async () => {
    const redis = new Redis();
    try {
        logger.info('Starting Redis validation for Uniswap data...');

        // Fetch top pools
        const poolKeys = await redis.keys('uniswap:pool:*');
        if (poolKeys.length === 0) {
            logger.error('No pool data found in Redis.');
            return;
        }

        for (const poolKey of poolKeys) {
            const poolData = JSON.parse(await redis.get(poolKey));
            const { id, token0, token1, totalValueLockedUSD, volumeUSD } = poolData;

            if (!id || !token0 || !token1 || !totalValueLockedUSD || !volumeUSD) {
                logger.error(`Invalid data for pool: ${poolKey}`);
                logger.error(`Data: ${JSON.stringify(poolData)}`);
                continue;
            }

            logger.info(`Validated pool: ${id}`);
        }

        // Fetch historical data
        const tokenKeys = await redis.keys('uniswap:token:*');
        if (tokenKeys.length === 0) {
            logger.error('No token historical data found in Redis.');
            return;
        }

        for (const tokenKey of tokenKeys) {
            const tokenData = JSON.parse(await redis.get(tokenKey));
            tokenData.forEach(({ date, priceUSD, volumeUSD, liquidityUSD }) => {
                if (!date || !priceUSD || !volumeUSD || !liquidityUSD) {
                    logger.error(`Invalid historical data for token: ${tokenKey}`);
                    logger.error(`Data: ${JSON.stringify(tokenData)}`);
                }
            });

            logger.info(`Validated historical data for token: ${tokenKey}`);
        }

        logger.info('Redis validation completed successfully.');
    } catch (error) {
        logger.error(`Validation failed: ${error.message}`);
    } finally {
        redis.disconnect();
    }
})();
