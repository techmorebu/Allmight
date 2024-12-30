// File: tests/test-uniswap-validation.js

const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

// Helper function to check Redis key and log missing keys
const checkRedisKey = async (redis, key) => {
    const exists = await redis.exists(key);
    if (!exists) {
        logger.warn(`Key not found in Redis: ${key}`);
        return null;
    }
    return JSON.parse(await redis.get(key));
};

// Helper function to validate pool data
const validatePoolData = (pool) => {
    const isValid =
        pool.id &&
        pool.token0 &&
        pool.token1 &&
        pool.token0.id &&
        pool.token1.id &&
        pool.totalValueLockedUSD &&
        pool.volumeUSD;
    return isValid;
};

// Helper function to validate token historical data
const validateHistoricalData = (data) => {
    if (!Array.isArray(data) || data.length === 0) return false;
    return data.every(
        (day) => day.date && day.priceUSD && day.volumeUSD && day.liquidityUSD
    );
};

// Main validation function
const validateUniswapData = async () => {
    try {
        logger.info('Starting Uniswap data validation...');

        const redis = new Redis();

        // Fetch all pool keys from Redis
        const poolKeys = await redis.keys('uniswap:pool:*');
        if (poolKeys.length === 0) {
            logger.warn('No pools found in Redis for Uniswap.');
            return;
        }

        for (const poolKey of poolKeys) {
            logger.info(`Validating data for pool key: ${poolKey}`);
            const poolData = await checkRedisKey(redis, poolKey);

            if (!poolData || !validatePoolData(poolData)) {
                logger.error(`Invalid pool data for key: ${poolKey}`);
                continue;
            }

            logger.info(`Validated pool data for key: ${poolKey}`);

            // Validate historical data for tokens in the pool
            for (const token of [poolData.token0, poolData.token1]) {
                const historicalKey = `uniswap:token:historical:${token.id}`;
                const historicalData = await checkRedisKey(redis, historicalKey);

                if (!historicalData || !validateHistoricalData(historicalData)) {
                    logger.error(
                        `Invalid or missing historical data for token: ${token.id}`
                    );
                    continue;
                }

                logger.info(`Validated historical data for token: ${token.id}`);
            }
        }

        redis.disconnect();
        logger.info('Uniswap data validation completed successfully.');
    } catch (error) {
        logger.error(`Validation failed: ${error.message}`);
    }
};

// Run validation
validateUniswapData();
