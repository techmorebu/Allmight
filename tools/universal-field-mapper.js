const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const uniswapDataFile = path.join(outputDir, "uniswap-data.json");
const uniswapRawDataFile = path.join(outputDir, "uniswap-raw-data.json");

// Ensure output directories exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Define Uniswap API endpoint
const uniswapApiUrl = process.env.UNISWAP_DEX_API;

// Transaction and Volume Thresholds
const TRANSACTION_THRESHOLD = 200;
const VOLUME_THRESHOLD = 50000;

// Function to fetch pool data dynamically
async function fetchPools(apiUrl) {
  const query = `{
    pools(first: 100) {
      id
      token0 {
        symbol
        priceUSD
      }
      token1 {
        symbol
        priceUSD
      }
      liquidity
      volumeUSD
      txCount
      collectedFeesToken0
      collectedFeesToken1
      poolDayData {
        date
        volumeUSD
        feesUSD
        txCount
      }
      poolHourData {
        periodStartUnix
        volumeUSD
        feesUSD
        txCount
      }
    }
  }`;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch pools: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data || !data.data || !data.data.pools) {
      console.warn("No pools data returned from the API.");
      return [];
    }

    return data.data.pools;
  } catch (error) {
    console.error("Error fetching pools:", error.message);
    return [];
  }
}

// Filter pools based on thresholds
function filterPools(pools) {
  return pools.filter((pool) => {
    const txCount = parseInt(pool.txCount, 10) || 0;
    const volumeUSD = parseFloat(pool.volumeUSD) || 0;
    return txCount >= TRANSACTION_THRESHOLD && volumeUSD >= VOLUME_THRESHOLD;
  });
}

// Fetch and process data for Uniswap
async function fetchUniswapData() {
  console.log("Fetching data for Uniswap...");

  const pools = await fetchPools(uniswapApiUrl);
  if (!pools.length) {
    console.warn("No pools retrieved.");
    return;
  }

  // Save raw data
  fs.writeFileSync(uniswapRawDataFile, JSON.stringify(pools, null, 2));
  console.log(`Raw data saved to ${uniswapRawDataFile}`);

  // Filter pools
  const filteredPools = filterPools(pools);
  console.log(`Filtered ${filteredPools.length} pools based on thresholds.`);

  // Save filtered data
  fs.writeFileSync(uniswapDataFile, JSON.stringify(filteredPools, null, 2));
  console.log(`Filtered data saved to ${uniswapDataFile}`);
}

// Run the Uniswap fetcher
(async () => {
  try {
    await fetchUniswapData();
    console.log("Uniswap data fetch completed.");
  } catch (error) {
    console.error("Error during Uniswap data fetch:", error.message);
  }
})();
