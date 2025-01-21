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

// Function to fetch pool data dynamically with pagination
async function fetchPools(apiUrl, skip = 0) {
  const query = `{
    pools(first: 100, skip: ${skip}) {
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
    swaps(first: 100, skip: ${skip}) {
      id
      amountUSD
      timestamp
      token0 {
        symbol
        priceUSD
      }
      token1 {
        symbol
        priceUSD
      }
    }
    mints(first: 100, skip: ${skip}) {
      id
      amountUSD
      timestamp
    }
    burns(first: 100, skip: ${skip}) {
      id
      amountUSD
      timestamp
    }
  }`;

  try {
    console.log(`Fetching pools and transactions with skip=${skip}...`);
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch pools and transactions: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data || !data.data) {
      console.warn("No data returned from the API. Response:", JSON.stringify(data, null, 2));
      return { pools: [], swaps: [], mints: [], burns: [] };
    }

    return {
      pools: data.data.pools || [],
      swaps: data.data.swaps || [],
      mints: data.data.mints || [],
      burns: data.data.burns || []
    };
  } catch (error) {
    console.error("Error fetching pools and transactions:", error.message);
    return { pools: [], swaps: [], mints: [], burns: [] };
  }
}

// Filter pools based on thresholds
function filterPools(pools) {
  return pools.filter((pool) => {
    const txCount = parseInt(pool.txCount, 10) || 0;
    const volumeUSD = parseFloat(pool.volumeUSD) || 0;
    const include = txCount >= TRANSACTION_THRESHOLD && volumeUSD >= VOLUME_THRESHOLD;
    console.log(`Pool ID: ${pool.id}, TxCount: ${txCount}, VolumeUSD: ${volumeUSD}, Included: ${include}`);
    return include;
  });
}

// Fetch and process data for Uniswap
async function fetchUniswapData() {
  console.log("Fetching comprehensive data for Uniswap...");

  let skip = 0;
  let allPools = [];
  let allSwaps = [];
  let allMints = [];
  let allBurns = [];

  while (true) {
    const { pools, swaps, mints, burns } = await fetchPools(uniswapApiUrl, skip);
    if (!pools.length && !swaps.length && !mints.length && !burns.length) break;

    allPools = allPools.concat(pools);
    allSwaps = allSwaps.concat(swaps);
    allMints = allMints.concat(mints);
    allBurns = allBurns.concat(burns);

    skip += 100;
  }

  if (!allPools.length) {
    console.warn("No pools retrieved. Check the API endpoint or schema.");
    return;
  }

  // Save raw data
  const rawData = { pools: allPools, swaps: allSwaps, mints: allMints, burns: allBurns };
  fs.writeFileSync(uniswapRawDataFile, JSON.stringify(rawData, null, 2));
  console.log(`Raw data saved to ${uniswapRawDataFile}`);

  // Filter pools
  const filteredPools = filterPools(allPools);
  console.log(`Filtered ${filteredPools.length} pools based on thresholds.`);

  // Save filtered data
  const filteredData = { pools: filteredPools, swaps: allSwaps, mints: allMints, burns: allBurns };
  fs.writeFileSync(uniswapDataFile, JSON.stringify(filteredData, null, 2));
  console.log(`Filtered data saved to ${uniswapDataFile}`);
}

// Run the Uniswap fetcher
(async () => {
  try {
    await fetchUniswapData();
    console.log("Uniswap comprehensive data fetch completed.");
  } catch (error) {
    console.error("Error during Uniswap data fetch:", error.message);
  }
})();
