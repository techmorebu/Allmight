// Required libraries
const axios = require('axios');
const dotenv = require('dotenv');
const winston = require('winston');

dotenv.config();

// Logger configuration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'fetch-uniswap-data.log' })
    ]
});

const UNISWAP_API_URL = process.env.UNISWAP_API_URL || 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';

/**
 * Fetch Uniswap pool data from The Graph API
 */
async function fetchUniswapData() {
    const query = `{
        pools(first: 10) {
            id
            token0 {
                symbol
            }
            token1 {
                symbol
            }
            feeTier
            liquidity
            sqrtPrice
        }
    }`;

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            const response = await axios.post(UNISWAP_API_URL, { query });
            if (response.data && response.data.data && response.data.data.pools) {
                const pools = response.data.data.pools.map(pool => ({
                    id: pool.id,
                    token0: pool.token0.symbol,
                    token1: pool.token1.symbol,
                    feeTier: pool.feeTier,
                    liquidity: pool.liquidity,
                    sqrtPrice: pool.sqrtPrice
                }));

                logger.info('Successfully fetched Uniswap data', { poolCount: pools.length });
                return pools;
            } else {
                throw new Error('Invalid response structure');
            }
        } catch (error) {
            attempts++;
            logger.error(`Error fetching Uniswap data (Attempt ${attempts} of ${maxAttempts}): ${error.message}`);
            if (attempts >= maxAttempts) {
                throw new Error('Max retry attempts reached for fetching Uniswap data');
            }
        }
    }
}

// Export the fetch function
module.exports = { fetchUniswapData };
