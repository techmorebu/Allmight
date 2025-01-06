const fs = require("fs");

// Load filtered pools data
const poolsData = require("./filtered-pools.json");

// Thresholds for filtering
const LIQUIDITY_THRESHOLD = 10000;
const VOLUME_THRESHOLD = 500;

// Function to calculate metrics (e.g., price change percentage)
function calculateMetrics(pool) {
  // Example: Add calculated price from sqrtPrice
  const price0 = Math.pow(pool.sqrtPrice, 2);
  pool.calculatedPrice0 = price0;

  return pool;
}

// Filter pools based on thresholds
function filterPools(pools) {
  return pools
    .filter(pool => pool.liquidity >= LIQUIDITY_THRESHOLD && pool.volumeUSD >= VOLUME_THRESHOLD)
    .map(calculateMetrics); // Add advanced metrics
}

// Run filtering and save results
try {
  console.log("🚀 Starting analysis...");
  const filteredPools = filterPools(poolsData);
  console.log(`✅ Filtered ${filteredPools.length} pools.`);

  fs.writeFileSync("final-pools.json", JSON.stringify(filteredPools, null, 2));
  console.log("✅ Final data saved to final-pools.json");
} catch (error) {
  console.error("❌ Error during analysis:", error);
}
