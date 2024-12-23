// Required libraries
const { fetchUniswapData } = require('../data-collection/fetch-uniswap-data.js');
const winston = require('winston');

// Logger configuration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [new winston.transports.Console()]
});

/**
 * Test function for Uniswap V3 Fetcher
 */
async function testUniswapFetcher() {
    logger.info('Starting test for Uniswap V3 Fetcher...');
    try {
        const data = await fetchUniswapData();

        if (data && data.length > 0) {
            logger.info('Uniswap V3 Fetcher Test Passed', { poolCount: data.length });
            console.table(data.map(pool => ({
                ID: pool.id,
                Token0: pool.token0,
                Token1: pool.token1,
                FeeTier: pool.feeTier,
                Liquidity: pool.liquidity,
                SqrtPrice: pool.sqrtPrice
            })));
        } else {
            logger.warn('Uniswap V3 Fetcher returned no data');
        }
    } catch (error) {
        logger.error('Uniswap V3 Fetcher Test Failed', { error: error.message });
    }
}

// Run the test
testUniswapFetcher();
