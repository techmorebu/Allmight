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

// Fetch token prices from CoinGecko API
async function fetchTokenPrices(tokens) {
  try {
    const ids = tokens.map((token) => token.id).join(",");
    const url = `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${ids}&vs_currencies=usd`;

    console.log(`📡 Fetching token prices from: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`❌ Failed to fetch token prices: ${response.statusText}`);
    }

    const prices = await response.json();
    console.log("✅ Token Prices Fetched:", prices);

    return prices;
  } catch (error) {
    console.error("❌ Error fetching token prices:", error);
    return {};
  }
}

// Analyze arbitrage opportunities
function analyzeArbitrage(pools, prices) {
  return pools
    .map((pool) => {
      const token0Price = prices[pool.token0.id]?.usd || 0;
      const token1Price = prices[pool.token1.id]?.usd || 0;

      const spread = Math.abs(token0Price - token1Price) / Math.max(token0Price, token1Price);
      const profitPotential = spread > 0.01; // Example threshold of 1% spread.

      return {
        ...pool,
        token0Price,
        token1Price,
        spread,
        profitPotential,
      };
    })
    .filter((pool) => pool.profitPotential); // Only keep profitable pools.
}

// Main function
async function main() {
  try {
    console.log("🚀 Starting arbitrage-ready fetcher...");

    if (!fs.existsSync(POOL_DATA_PATH)) {
      throw new Error("❌ Pool data not found! Ensure `final-pools.json` exists.");
    }

    const poolData = JSON.parse(fs.readFileSync(POOL_DATA_PATH, "utf-8"));
    console.log("✅ Loaded Pool Data:", poolData);

    const allTokens = [...new Set(poolData.flatMap((pool) => [pool.token0, pool.token1]))];
    const prices = await fetchTokenPrices(allTokens);

    const arbitrageData = analyzeArbitrage(poolData, prices);
    console.log("✅ Arbitrage Data:", arbitrageData);

    fs.writeFileSync(ARBITRAGE_DATA_PATH, JSON.stringify(arbitrageData, null, 2));
    console.log(`✅ Arbitrage-ready data saved to: ${ARBITRAGE_DATA_PATH}`);
  } catch (error) {
    console.error("❌ Error in main script:", error);
  }
}

// Run the script
main();
