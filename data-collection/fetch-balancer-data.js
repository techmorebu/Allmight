const axios = require('axios');
const { createClient } = require('redis');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const networks = {
  ethereum: process.env.BALANCER_ETHEREUM,
  polygon: process.env.BALANCER_POLYGON,
  optimism: process.env.BALANCER_OPTIMISIM,
  arbitrum: process.env.BALANCER_ARBITRUM,
  avalanche: process.env.BALANCER_AVALANCHE,
};

async function fetchBalancerData(network, url) {
  try {
    logger.info(`Fetching Balancer data for ${network}...`);
    const response = await axios.post(url, {
      query: `
        {
          pools(first: 10, orderBy: totalLiquidity, orderDirection: desc) {
            id
            tokens {
              symbol
              balance
            }
            totalLiquidity
            swapFee
          }
        }
      `,
    });
    const pools = response.data.data.pools;
    logger.info(`Fetched ${pools.length} pools for ${network}.`);

    const redis = createClient();
    await redis.connect();
    await redis.set(`balancer:pools:${network}`, JSON.stringify(pools));
    logger.info(`Stored ${network} pools in Redis.`);
    await redis.quit();
  } catch (error) {
    logger.error(`Error fetching data for ${network}: ${error.message}`);
  }
}

async function fetchAllNetworks() {
  await Promise.all(
    Object.entries(networks).map(([network, url]) => fetchBalancerData(network, url))
  );
  logger.info('Balancer data fetching completed for all networks.');
}

fetchAllNetworks();
