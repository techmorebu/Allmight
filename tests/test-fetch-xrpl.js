async function validateKey(key) {
    try {
        const data = await redisClient.get(key);
        if (!data) {
            logger.error(`No data found for key: ${key}`);
        } else {
            logger.info(`Validated data for key: ${key}`);
            logger.debug(`Data: ${data}`);
        }
    } catch (error) {
        logger.error(`Error retrieving key ${key}: ${error.message}`);
    }
}

async function validateXRPLData() {
    logger.info("Starting XRPL data validation...");
    const keys = [
        'xrpl:server_info',
        `xrpl:account:${XRPL_PUBLIC_KEY}`,
        `xrpl:tx:${XRPL_PUBLIC_KEY}`,
    ];

    for (const key of keys) {
        await validateKey(key);
    }

    logger.info("XRPL data validation completed.");
    redisClient.quit();
}

validateXRPLData().catch((error) => {
    logger.error(`Validation script error: ${error.message}`);
});
