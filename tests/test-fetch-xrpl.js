require('dotenv').config();
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const redis = new Redis();

async function validateData(key) {
    try {
        logger.info(`Validating data for key: ${key}`);
        const data = await redis.get(key);
        if (!data) {
            logger.error(`No data found for key: ${key}`);
            return false;
        }
        logger.info(`Data for key ${key} is valid.`);
        return true;
    } catch (error) {
        logger.error(`Error during validation for key ${key}: ${error.message}`);
        return false;
    }
}

async function runValidation() {
    logger.info('Starting XRPL data validation...');
    const keys = [
        'xrpl:server_info',
        `xrpl:account:${process.env.XRPL_PUBLIC_KEY}`,
        `xrpl:tx:${process.env.XRPL_PUBLIC_KEY}`
    ];

    for (const key of keys) {
        await validateData(key);
    }

    logger.info('XRPL data validation completed.');
    redis.disconnect();
}

runValidation();
