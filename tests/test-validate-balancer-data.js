const { createClient } = require('redis');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

async function validateBalancerData(network) {
  try {
    const redis = createClient();
    await redis.connect();

    logger.info(`Validating Balancer data for ${network}...`);
    const data = await redis.get(`balancer:pools:${network}`);
    if (!data) {
      logger.error(`No data found for ${network} in Redis.`);
      return;
    }

    const pools = JSON.parse(data);
    pools.forEach((pool) => {
      if (!pool.id || !pool.totalLiquidity || !pool.swapFee) {
        logger.warn(`Invalid pool data: ${JSON.stringify(pool)}`);
      } else {
        logger.info(`Validated pool ${pool.id} for ${network}.`);
      }
    });

    await redis.quit();
  } catch (error) {
    logger.error(`Error validating data for ${network}: ${error.message}`);
  }
}

async function validateAllNetworks() {
  const networks = ['ethereum', 'polygon', 'optimism', 'arbitrum', 'avalanche'];
  await Promise.all(networks.map(validateBalancerData));
  logger.info('Balancer data validation completed for all networks.');
}

validateAllNetworks();
