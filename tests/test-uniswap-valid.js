const Redis = require("ioredis");
const logger = require("../monitoring/logger");
const redis = new Redis();

async function validateUniswapData() {
  logger.info("Starting Uniswap data validation...");

  try {
    // Get all pool keys
    const poolKeys = await redis.keys("uniswap:pool:*");

    if (poolKeys.length === 0) {
      logger.warn("No Uniswap pool data found in Redis.");
      return;
    }

    let validPools = 0;
    let invalidPools = 0;
    let historicalDataIssues = 0;

    for (const poolKey of poolKeys) {
      const poolData = await redis.hgetall(poolKey);

      if (Object.keys(poolData).length === 0) {
        logger.error(`Pool data is missing or invalid for key: ${poolKey}`);
        invalidPools++;
        continue;
      }

      // Validate pool data structure
      if (!poolData.token0 || !poolData.token1 || !poolData.totalValueLockedUSD || !poolData.volumeUSD) {
        logger.error(`Incomplete pool data for key: ${poolKey}`);
        invalidPools++;
        continue;
      }

      logger.info(`Validated pool data for key: ${poolKey}`);
      validPools++;

      // Historical Data Validation
      const tokenKeys = [
        `uniswap:token:historical:${poolData.token0}`,
        `uniswap:token:historical:${poolData.token1}`,
      ];

      for (const tokenKey of tokenKeys) {
        const historicalData = await redis.get(tokenKey);

        if (!historicalData) {
          logger.warn(`Key not found in Redis: ${tokenKey}`);
          historicalDataIssues++;
          continue;
        }

        const parsedData = JSON.parse(historicalData);
        if (!Array.isArray(parsedData) || parsedData.length === 0) {
          logger.error(`Invalid historical data for token key: ${tokenKey}`);
          historicalDataIssues++;
        } else {
          logger.info(`Validated historical data for token key: ${tokenKey}`);
        }
      }
    }

    logger.info(`Validation Summary: 
      Valid Pools: ${validPools} 
      Invalid Pools: ${invalidPools} 
      Historical Data Issues: ${historicalDataIssues}`);

  } catch (error) {
    logger.error(`Error during Uniswap data validation: ${error.message}`);
  } finally {
    redis.disconnect();
    logger.info("Uniswap data validation completed.");
  }
}

validateUniswapData();
