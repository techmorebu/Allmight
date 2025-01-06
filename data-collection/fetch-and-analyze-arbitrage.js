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

// File Paths
const POOL_DATA_PATH = path.resolve(__dirname, "../logs/final-pools.json");
const ARBITRAGE_DATA_PATH = path.resolve(__dirname, "../logs/arbitrage-ready-pools.json");

// GraphQL Query to Fetch Pools and Prices
async function fetchPoolData() {
  const query = `
    query {
      pools {
        id
        token0 {
          id
          symbol
          name
        }
        token1 {
          id
          symbol
          name
        }
        token0Price
        token1Price
        volumeUSD
        liquidity
      }
    }
  `;

  try {
    const apiUrl = process.env.API_URL;

    if (!apiUrl) {
      throw new Error("❌ API_URL is not defined in the .env file");
    }

    console.log(`📡 Fetching pool data from: ${apiUrl}`);
    const response = await fetch(apiUrl, {
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
    console.log("✅ Pool Data Fetched:", JSON.stringify(data, null, 2));

    if (data.errors) {
      throw new Error(`❌ Errors in API response: ${JSON.stringify(data.errors, null, 2)}`);
    }

    return data.data.pools || [];
  } catch (error) {
    console.error("❌ Error fetching pool data:", error);
    return [];
  }
}

// Analyze arbitrage opportunities
function analyzeArbitrage(pools) {
  return pools
    .map((pool) => {
      const token0Price = parseFloat(pool.token0Price || 0);
      const token1Price = parseFloat(pool.token1Price || 0);

      // Calculate spread
      const spread = Math.abs(token0Price - token1Price) / Math.max(token0Price, token1Price);
      const profitPotential = spread > 0.01; // Example threshold of 1% spread.

      return {
        ...pool,
        spread,
        profitPotential,
      };
    })
    .filter((pool) => pool.profitPotential); // Only keep profitable pools.
}

// Main function
async function main() {
  try {
    console.log("🚀 Starting Quickswap fetcher with real-time prices...");

    const pools = await fetchPoolData();
    if (!pools.length) {
      throw new Error("❌ No pools data found. Check the subgraph or API.");
    }

    const arbitrageData = analyzeArbitrage(pools);
    console.log("✅ Arbitrage Data:", JSON.stringify(arbitrageData, null, 2));

    fs.writeFileSync(ARBITRAGE_DATA_PATH, JSON.stringify(arbitrageData, null, 2));
    console.log(`✅ Arbitrage-ready data saved to: ${ARBITRAGE_DATA_PATH}`);
  } catch (error) {
    console.error("❌ Error in main script:", error);
  }
}

// Run the script
main();
