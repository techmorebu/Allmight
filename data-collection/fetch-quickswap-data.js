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

const API_URL = process.env.QUICKSWAP_API;
if (!API_URL) {
  console.error("❌ QUICKSWAP_API is not defined in the .env file");
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

async function fetchQuickswapData() {
  try {
    console.log("🚀 Starting Quickswap data fetch...");
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
    console.error("❌
