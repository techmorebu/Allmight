require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

// Global error handling
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection:", reason);
});

const API_URL = process.env.UNISWAP_API;
if (!API_URL) {
  console.error("❌ UNISWAP_API is not defined in the .env file");
  process.exit(1);
}

// Generated query file from schema analysis
const queryFilePath = path.resolve(__dirname, "../logs/generated-query.graphql");
if (!fs.existsSync(queryFilePath)) {
  console.error("❌ No generated query file found. Run the schema analysis first.");
  process.exit(1);
}

// Load the query
const query = fs.readFileSync(queryFilePath, "utf8");

async function fetchuniswapData() {
  try {
    console.log("🚀 Starting uniswap data fetch...");
    console.log(`📡 Fetching data from: ${API_URL}`);

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`❌ Failed to fetch data: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.errors) {
      console.error("❌ Errors in API response:", JSON.stringify(data.errors, null, 2));
      return;
    }

    const pools = data.data?.pools || [];
    console.log("✅ Raw Pools Data Fetched:", JSON.stringify(pools, null, 2));

    // Filter pools for arbitrage opportunities
    const filteredPools = filterPools(pools);
    console.log("✅ Filtered Pools:", JSON.stringify(filteredPools, null, 2));

    // Save filtered pools to file
    const outputPath = path.resolve(__dirname, "../logs/arbitrage-ready-pools.json");
    fs.writeFileSync(outputPath, JSON.stringify(filteredPools, null, 2));
    console.log(`✅ Filtered pools saved to: ${outputPath}`);

    return filteredPools;
  } catch (error) {
    console.error("❌ Error in fetchuniswapData:", error);
  }
}

function filterPools(pools) {
  console.log("🔍 Filtering pools for arbitrage-ready data...");
  return pools.filter((pool) => {
    // Ensure critical fields exist and meet basic thresholds
    const requiredFields = ["id", "token0", "token1", "volumeUSD", "liquidity"];
    for (const field of requiredFields) {
      if (!pool[field]) {
        console.warn(`⚠️ Pool missing field: ${field}`);
        return false;
      }
    }

    // Custom filtering logic
    const minVolumeUSD = 1000; // Example threshold for minimum volume
    const minLiquidity = 5000; // Example threshold for minimum liquidity
    return parseFloat(pool.volumeUSD) > minVolumeUSD && parseFloat(pool.liquidity) > minLiquidity;
  });
}

// Immediately invoke the function to fetch data
(async () => {
  try {
    await fetchuniswapData();
  } catch (error) {
    console.error("❌ Uncaught error in script:", error);
  }
})();
