const Redis = require('ioredis');
const logger = require('../monitoring/logger');

async function validateUniswapData() {
    try {
        logger.info('Starting Uniswap data validation...');
        const redis = new Redis();

        const keys = await redis.keys('uniswap:pool:*');
        for (const key of keys) {
            const poolData = await redis.get(key);
            if (!poolData) {
                logger.error(`Missing data for pool key: ${key}`);
                continue;
            }
            logger.info(`Validated pool data for key: ${key}`);

            const pool = JSON.parse(poolData);
            const tokens = [pool.token0, pool.token1];

            for (const token of tokens) {
                const historicalKey = `uniswap:token:historical:${token}`;
                const historicalData = await redis.get(historicalKey);
                if (!historicalData) {
                    logger.warn(`Missing historical data for token: ${token}`);
                    continue;
                }
                logger.info(`Validated historical data for token: ${token}`);
            }
        }

        logger.info('Uniswap data validation completed.');
        redis.quit();
    } catch (error) {
        logger.error(`Error during validation: ${error.message}`);
    }
}

validateUniswapData();
