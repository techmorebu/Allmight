const Redis = require('ioredis');
const logger = require('../monitoring/logger'); // Ensure logger is imported correctly

async function validateUniswapData() {
    try {
        logger.log('info', 'Starting Uniswap data validation...');
        const redis = new Redis();

        const keys = await redis.keys('uniswap:pool:*');
        if (keys.length === 0) {
            logger.log('warn', 'No pool data found in Redis.');
            return;
        }

        for (const key of keys) {
            const poolData = await redis.get(key);
            if (!poolData) {
                logger.log('warn', `Missing data for pool key: ${key}`);
                continue;
            }
            logger.log('info', `Validated pool data for key: ${key}`);

            const pool = JSON.parse(poolData);
            const tokens = [pool.token0, pool.token1];

            for (const token of tokens) {
                const historicalKey = `uniswap:token:historical:${token}`;
                const historicalData = await redis.get(historicalKey);
                if (!historicalData) {
                    logger.log('warn', `Missing historical data for token: ${token}`);
                    continue;
                }
                logger.log('info', `Validated historical data for token: ${token}`);
            }
        }

        logger.log('info', 'Uniswap data validation completed.');
        redis.quit();
    } catch (error) {
        logger.log('error', `Error during validation: ${error.message}`);
    }
}

validateUniswapData();
