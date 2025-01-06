const fs = require("fs");

// Load raw pools data
const rawPools = require("./logs/raw-pools.json"); // Adjust the path as needed
const validPools = [];

// Define stablecoins and transaction count threshold
const stablecoins = ["DAI", "USDC", "USDT"];
const minTxCount = 400; // Minimum transaction count

// Process each pool
rawPools.forEach((pool) => {
  const txCount = parseInt(pool.txCount || "0", 10);

  // Check for stablecoin pairs
  const token0Stable = stablecoins.includes(pool.token0.symbol);
  const token1Stable = stablecoins.includes(pool.token1.symbol);

  // Determine validity based on conditions
  const isValid = token0Stable || token1Stable || txCount > minTxCount;

  if (isValid) {
    validPools.push({
      id: pool.id,
      volumeUSD: pool.volumeUSD,
      liquidity: pool.liquidity,
      txCount: pool.txCount,
      token0: {
        id: pool.token0.id,
        name: pool.token0.name,
        symbol: pool.token0.symbol,
      },
      token1: {
        id: pool.token1.id,
        name: pool.token1.name,
        symbol: pool.token1.symbol,
      },
    });

    console.log(`✅ Pool ${pool.id} included: ${txCount} transactions; token0=${pool.token0.symbol}, token1=${pool.token1.symbol}`);
  } else {
    console.log(`⚠️ Pool ${pool.id} excluded: Does not meet stablecoin or transaction count criteria.`);
  }
});

// Save valid pools to a file
fs.writeFileSync(
  "./logs/final-pools.json", // Adjust the path as needed
  JSON.stringify(validPools, null, 2)
);

console.log(`🎉 Filtering complete. Valid pools saved to logs/final-pools.json`);
