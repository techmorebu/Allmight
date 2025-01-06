require("dotenv").config();
const fs = require("fs");
const fetch = require("node-fetch");

// Helper function for filtering pools
const filterPools = (pools) => {
  const stablecoins = ["DAI", "USDC", "USDT"];
  const minTxCount = 400;
  const validPools = [];

  pools.forEach((pool) => {
    const txCount = parseInt(pool.txCount || "0", 10);

    // Check for stablecoin pairs
    const token0Stable = stablecoins.includes(pool.token0.symbol);
    const token1Stable = stablecoins.includes(pool.token1.symbol);

    // Determine validity based on conditions
    if (token0Stable || token1Stable || txCount > minTxCount) {
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
    }
  });

  return validPools;
};

// Main fetcher function
const fetchData = async () => {
  try {
    console.log("🚀 Starting automate-fetcher workflow...");

    const apiUrl = process.env.QUICKSWAP_API;
    if (!apiUrl) throw new Error("❌ API endpoint missing in .env file");

    console.log(`📡 Fetching data from: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: fs.readFileSync("./logs/generated-query.graphql", "utf-8"),
      }),
    });

    if (!response.ok) throw new Error(`❌ Failed to fetch data: ${response.statusText}`);

    const data = await response.json();
    if (data.errors) throw new Error(`❌ API Errors: ${JSON.stringify(data.errors)}`);

    console.log("✅ Raw data fetched successfully.");

    // Filter pools
    const rawPools = data.data.pools || [];
    const filteredPools = filterPools(rawPools);

    // Save filtered pools to a file
    fs.writeFileSync("./logs/final-pools.json", JSON.stringify(filteredPools, null, 2));
    console.log("🎉 Filtered pools saved to logs/final-pools.json");

  } catch (error) {
    console.error("❌ Error in automate-fetcher:", error);
  }
};

// Run the fetcher
fetchData();
