const fs = require("fs");

function analyzePools() {
  try {
    console.log("🚀 Starting pool analysis...");

    const rawData = fs.readFileSync("./logs/filtered-pools.json", "utf8");
    const pools = JSON.parse(rawData);

    console.log(`✅ Loaded ${pools.length} pools for analysis.`);

    // Filter criteria
    const MIN_VOLUME_USD = 1000; // Minimum volume in USD
    const MIN_LIQUIDITY = 500; // Minimum liquidity

    const filteredPools = pools.filter((pool) => {
      const volume = parseFloat(pool.volumeUSD || "0");
      const liquidity = parseFloat(pool.liquidity || "0");
      return volume >= MIN_VOLUME_USD && liquidity >= MIN_LIQUIDITY;
    });

    console.log(`✅ Filtered down to ${filteredPools.length} pools.`);

    // Save to final JSON file
    fs.writeFileSync("./logs/final-pools.json", JSON.stringify(filteredPools, null, 2));
    console.log("✅ Filtered pools saved to ./logs/final-pools.json");
  } catch (error) {
    console.error("❌ Error in analyzePools:", error);
  }
}

// Execute the analysis
analyzePools();
