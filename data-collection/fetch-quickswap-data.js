require("dotenv").config(); // Load environment variables
const { fetchApiData } = require("./api-fetcher"); // Correct path to the fetcher module
const { validateApiData } = require("../validators/validate-api-data"); // Schema validator
const Redis = require("ioredis"); // Redis client for caching
const redis = new Redis(); // Initialize Redis
const { logger } = require("../monitoring/logger"); // Logging utility

// GraphQL query for QuickSwap
const quickswapQuery = `
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

// Fetch and validate QuickSwap data
async function fetchQuickSwapData() {
  try {
    logger.info("Fetching data from QuickSwap...");
    const rawData = await fetchApiData(process.env.QUICKSWAP_API, quickswapQuery);

    if (!rawData.data || !rawData.data.pools) {
      throw new Error("No pools found in QuickSwap response.");
    }

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
      platform: "QuickSwap",
      chainId: 137, // Polygon chain
    }));

    for (const pool of pools) {
      const validation = validateApiData(pool);
      if (!validation.valid) {
        logger.error("Validation failed for pool:", pool, validation.errors);
        continue;
      }

      const cacheKey = `QuickSwap:Pool:${pool.pair}`;
      await redis.set(cacheKey, JSON.stringify(pool), "EX", 3600); // Cache for 1 hour
      logger.info(`Validated and cached: ${cacheKey}`);
    }

    logger.info("✅ QuickSwap data fetch complete");
  } catch (error) {
    logger.error("❌ Error fetching QuickSwap data:", error.message);
  } finally {
    redis.disconnect();
  }
}

// Execute the fetcher
fetchQuickSwapData();
