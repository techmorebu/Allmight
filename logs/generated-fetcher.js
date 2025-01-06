require("dotenv").config();
const fetch = require("node-fetch");

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
                    token0Price
                    token1Price
                    totalValueLockedUSD
                    volumeToken0
                    volumeToken1
                    liquidityProviderCount
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
    console.log("✅ Raw Data Fetched:", JSON.stringify(data, null, 2));

    if (data.errors) {
      console.error("❌ Errors in API response:", JSON.stringify(data.errors, null, 2));
      return;
    }

    const pools = data.data.pools;
    console.log("✅ Pools Data:", pools);

    if (!pools || pools.length === 0) {
      console.log("⚠️ No pools data found");
      return;
    }

    const validatedPools = pools.filter((pool) => validatePool(pool));
    console.log("✅ Validated Pools:", JSON.stringify(validatedPools, null, 2));

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

// Immediately invoking the fetchData function to run the script
(async () => {
  try {
    await fetchData();
  } catch (error) {
    console.error("❌ Uncaught error in script:", error);
  }
})();
