require('dotenv').config();
const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');
const { fetchApiData } = require("../utils/api-fetcher");
const { validateApiData } = require("../validators/validate-api-data");

const uniswapQuery = `
{
  pools(first: 10) {
    id
    token0 { symbol address decimals }
    token1 { symbol address decimals }
    volumeUSD
    totalLiquidity
    txCount
    swapFee
  }
}`;

async function fetchUniswapData() {
  try {
    const rawData = await fetchApiData("uniswap", uniswapQuery);

    const pools = rawData.data.pools.map(pool => ({
      pair: `${pool.token0.symbol}-${pool.token1.symbol}`,
      price: parseFloat(pool.totalLiquidity) / parseFloat(pool.volumeUSD),
      volumeUSD: parseFloat(pool.volumeUSD),
      liquidityUSD: parseFloat(pool.totalLiquidity),
      lastUpdated: new Date().toISOString(),
      token0: {
        symbol: pool.token0.symbol,
        address: pool.token0.address,
        decimals: pool.token0.decimals,
      },
      token1: {
        symbol: pool.token1.symbol,
        address: pool.token1.address,
        decimals: pool.token1.decimals,
      },
      txCount: parseInt(pool.txCount),
      swapFee: parseFloat(pool.swapFee),
      platform: "Uniswap",
      chainId: 1,
    }));

    for (const pool of pools) {
      const validation = validateApiData(pool);
      if (!validation.valid) {
        console.error("Validation failed for pool:", pool, validation.errors);
        continue;
      }

      const cacheKey = `Uniswap:Pool:${pool.pair}`;
      await redis.set(cacheKey, JSON.stringify(pool), "EX", 3600); // Cache for 1 hour
      console.log(`Validated and cached: ${cacheKey}`);
    }

    console.log("✅ Uniswap data fetch complete");
  } catch (error) {
    console.error("❌ Error fetching Uniswap data:", error.message);
  }
}

module.exports = fetchUniswapData;
