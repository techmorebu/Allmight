(async () => {
    const redis = new Redis();
    try {
        logger.info('Starting Redis validation for Uniswap data...');

        // Validate pool data
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

        // Validate token historical data
        const tokenKeys = await redis.keys('uniswap:token:*');
        if (tokenKeys.length === 0) {
            logger.error('No token historical data found in Redis.');
        } else {
            for (const tokenKey of tokenKeys) {
                const tokenData = JSON.parse(await redis.get(tokenKey));
                if (!tokenData || tokenData.length === 0) {
                    logger.error(`Empty or invalid data for token: ${tokenKey}`);
                } else {
                    tokenData.forEach(({ date, priceUSD, volumeUSD, liquidityUSD }) => {
                        if (!date || !priceUSD || !volumeUSD || !liquidityUSD) {
                            logger.error(`Incomplete historical data for token: ${tokenKey}`);
                            logger.error(`Data: ${JSON.stringify(tokenData)}`);
                        }
                    });
                    logger.info(`Validated historical data for token: ${tokenKey}`);
                }
            }
        }

        logger.info('Redis validation completed successfully.');
    } catch (error) {
        logger.error(`Validation failed: ${error.message}`);
    } finally {
        redis.disconnect();
    }
})();
