const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

// Load environment variables
require('dotenv').config();

const redis = new Redis();

async function testThorchainData() {
    try {
        logger.info('Testing Thorchain data fetching...');
        
        const poolData = await redis.get('thorchain:pools');
        if (!poolData) {
            logger.error('❌ Thorchain pool data not found in Redis.');
        } else {
            logger.info('✅ Thorchain pool data validated successfully.');
        }

        const swapData = await redis.get('thorchain:swaps');
        if (!swapData) {
            logger.error('❌ Thorchain swap data not found in Redis.');
        } else {
            logger.info('✅ Thorchain swap data validated successfully.');
        }

        const feeData = await redis.get('thorchain:fees');
        if (!feeData) {
            logger.error('❌ Thorchain fee data not found in Redis.');
        } else {
            logger.info('✅ Thorchain fee data validated successfully.');
        }
    } catch (error) {
        logger.error(`Error in Thorchain test script: ${error.message}`);
    } finally {
        redis.disconnect();
    }
}

testThorchainData();
