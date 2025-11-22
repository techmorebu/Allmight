
//Legacy
const fs = require("fs");

// Load raw data
const rawDataPath = "./logs/raw-data.json";
const filteredDataPath = "./logs/filtered-pool-data.json";

fs.readFile(rawDataPath, "utf8", (err, data) => {
  if (err) {
    console.error("❌ Error reading raw data file:", err);
    return;
  }

  try {
    const jsonData = JSON.parse(data);

    if (!jsonData.data || !jsonData.data.pools) {
      console.error("❌ Invalid data format: No pools found");
      return;
    }

    const filteredPools = jsonData.data.pools.filter(pool => {
      const volumeUSD = parseFloat(pool.volumeUSD || "0");
      const totalLiquidity = parseFloat(pool.totalValueLockedUSD || "0");

      return volumeUSD > 10000 && totalLiquidity > 50000;
    }).map(pool => ({
      id: pool.id,
      token0: {
        name: pool.token0.name,
        symbol: pool.token0.symbol,
      },
      token1: {
        name: pool.token1.name,
        symbol: pool.token1.symbol,
      },
      volumeUSD: pool.volumeUSD,
      totalValueLockedUSD: pool.totalValueLockedUSD,
    }));

    console.log(`✅ Filtered ${filteredPools.length} high-value pools`);

    // Save filtered data
    fs.writeFile(filteredDataPath, JSON.stringify(filteredPools, null, 2), err => {
      if (err) {
        console.error("❌ Error saving filtered data:", err);
        return;
      }
      console.log(`✅ Filtered data saved to ${filteredDataPath}`);
    });

  } catch (error) {
    console.error("❌ Error processing data:", error);
  }
});
