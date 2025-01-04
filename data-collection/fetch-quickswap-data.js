const axios = require("axios");
const { logger } = require("../monitoring/logger");
const redis = require("redis");
const { promisify } = require("util");

const client = redis.createClient();
const setAsync = promisify(client.set).bind(client);

const QUICKSWAP_API = process.env.QUICKSWAP_API;

async function fetchQuickSwapData() {
  try {
    logger.info("Starting QuickSwap data fetcher...");
    logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);

    const query = `
      {
        pools(first: 100, orderBy: volumeUSD, orderDirection: desc) {
          id
          token0 {
            id
            symbol
          }
          token1 {
            id
            symbol
          }
          volumeUSD
          reserveUSD
        }
      }
    `;

    const response = await axios.post(QUICKSWAP_API, { query });

    if (!response.data || !response.data.data || !response.data.data.pools) {
      logger.error("Invalid or null response from QuickSwap API.");
      logger.error(`Response data: ${JSON.stringify(response.data, null, 2)}`);
      return;
    }

    const pools = response.data.data.pools;

    logger.info(`Fetched ${pools.length} pools from QuickSwap.`);
    await setAsync("quickswap:pools", JSON.stringify(pools));
    logger.info("Stored QuickSwap pools in Redis.");
  } catch (error) {
    logger.error("Error fetching QuickSwap data:", error.message);
    if (error.response) {
      logger.error(`Response status: ${error.response.status}`);
      logger.error(`Response data: ${JSON.stringify(error.response.data, null, 2)}`);
    }
  } finally {
    client.quit();
  }
}

fetchQuickSwapData();
