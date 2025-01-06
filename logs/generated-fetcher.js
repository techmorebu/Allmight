require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");

// Adding global error handling
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection:", reason);
});

async function fetchData() {
  try {
    console.log("🚀 Starting fetcher script...");
    const apiUrl = process.env.API_URL;

    if (!apiUrl) {
      throw new Error("❌ API_URL is not defined in the .env file");
    }

    console.log(`📡 Fetching data from: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          query {
            pools {
              id
              volumeUSD
              txCount
              liquidity
              feesUSD
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
              sqrtPrice
              tick
            }
          }
        `,
      }),
    });

    if (!response.ok) {
      throw new Error(`❌ Failed to fetch data: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("✅ Raw API Response:", JSON.stringify(data, null, 2));

    if (data.errors) {
      console.error("❌ Errors in API response:", JSON.stringify(data.errors, null, 2));
      return;
    }

    if (!data || !data.data || !data.data.pools || data.data.pools.length === 0) {
      console.error("❌ Invalid data format: No pools found");
      console.log("Fetched data:", JSON.stringify(data, null, 2)); // Log raw data for debugging
      return;
    }

    const pools = data.data.pools;
    console.log("✅ Pools Data:", pools);

    const validatedPools = pools.filter((pool) => validatePool(pool));
    console.log("✅ Validated Pools:", JSON.stringify(validatedPools, null, 2));

    saveData(validatedPools, "./logs/filtered-pools.json");

    return validatedPools;
  } catch (error) {
    console.error("❌ Error in fetchData:", error);
  }
}

function validatePool(pool) {
  console.log(`🔍 Validating pool: ${JSON.stringify(pool, null, 2)}`);
  const requiredFields = ["id", "txCount", "volumeUSD", "sqrtPrice", "tick"];
  for (const field of requiredFields) {
    if (!pool[field]) {
      console.warn(`⚠️ Missing field: ${field}`);
      return false;
    }
  }
  return true;
}

function saveData(data, filePath) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`✅ Data saved to: ${filePath}`);
  } catch (error) {
    console.error("❌ Error saving data:", error);
  }
}

// Immediately invoking the fetchData function to run the script
(async () => {
  try {
    await fetchData();
  } catch (error) {
    console.error("❌ Uncaught error in script:", error);
  }
})();
