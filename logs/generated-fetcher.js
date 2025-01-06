require("dotenv").config();
const fetch = require("node-fetch");

// Constants for filtering
const MIN_LIQUIDITY = 10000; // Minimum acceptable liquidity in USD
const MIN_VOLUME = 5000; // Minimum volume to consider high activity

// Error Handling
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});

// Function to fetch pools
const fetchPools = async (skip = 0, first = 10) => {
  try {
    console.log(`🚀 Fetching pools data (skip: ${skip}, first: ${first})...`);
    const response = await fetch(process.env.API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          query {
            pools(first: ${first}, skip: ${skip}, orderBy: volumeUSD, orderDirection: desc) {
              id
              liquidity
              volumeUSD
              totalValueLockedUSD
              token0 {
                id
                name
                symbol
              }
              token1 {
                id
                name
                symbol
              }
              swaps(first: 5, orderBy: timestamp, orderDirection: desc) {
                amountUSD
                timestamp
              }
              poolDayData(first: 3) {
                date
                volumeUSD
              }
              poolHourData(first: 3) {
                hour
                volumeUSD
              }
            }
          }
        `,
      }),
    });

    if (!response.ok) {
      throw new Error(`❌ Failed to fetch data: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors) {
      console.error("❌ Errors in API response:", JSON.stringify(data.errors, null, 2));
      return [];
    }

    return data.data.pools;
  } catch (error) {
    console.error("❌ Error in fetchPools:", error);
    return [];
  }
};

// Filter pools based on criteria
const filterPools = (pools) => {
  console.log("🔍 Filtering pools...");
  return pools.filter((pool) => {
    const isValidLiquidity = parseFloat(pool.liquidity) > MIN_LIQUIDITY;
    const isValidVolume = parseFloat(pool.volumeUSD) > MIN_VOLUME;

    if (!isValidLiquidity || !isValidVolume) return false;

    console.log(`✅ Valid Pool: ${pool.id} (Liquidity: ${pool.liquidity}, VolumeUSD: ${pool.volumeUSD})`);
    return true;
  });
};

// Main fetcher
const main = async () => {
  try {
    console.log("🚀 Starting enhanced fetcher...");
    const allPools = [];
    let skip = 0;
    const chunkSize = 10;

    while (true) {
      const pools = await fetchPools(skip, chunkSize);
      if (pools.length === 0) break;
      allPools.push(...pools);
      skip += chunkSize;
    }

    const filteredPools = filterPools(allPools);
    console.log("✅ Final Validated Pools:", JSON.stringify(filteredPools, null, 2));

    // Save to file if needed
    // const fs = require("fs");
    // fs.writeFileSync("validated-pools.json", JSON.stringify(filteredPools, null, 2));

    return filteredPools;
  } catch (error) {
    console.error("❌ Error in main fetcher:", error);
  }
};

// Execute the script
(async () => {
  await main();
})();
