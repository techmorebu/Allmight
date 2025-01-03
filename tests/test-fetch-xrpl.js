require('dotenv').config();
const { createClient } = require('redis');
const { logger } = require('../monitoring/logger');

const redis = createClient();
redis.connect();

const XRPL_PUBLIC_KEY = process.env.XRPL_PUBLIC_KEY;

async function validateData() {
    try {
        logger.info('Starting XRPL data validation...');
        
        const keysToValidate = [
            'xrpl:server_info',
            `xrpl:account:${XRPL_PUBLIC_KEY}`,
            `xrpl:tx:${XRPL_PUBLIC_KEY}`
        ];

        for (const key of keysToValidate) {
            const data = await redis.get(key);
            if (data) {
                logger.info(`Validated data for key: ${key}`);
            } else {
                logger.error(`No data found for key: ${key}`);
            }
        }

        logger.info('XRPL data validation completed.');
    } catch (error) {
        logger.error(`Error during XRPL data validation: ${error.message}`);
    } finally {
        redis.quit();
    }
}

validateData();
