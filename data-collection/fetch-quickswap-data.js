require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");

async function fetchQuickswapData() {
  try {
    console.log("🚀 Fetching data from Quickswap...");
    const apiUrl = process.env.QUICKSWAP_API_URL;

    if (!apiUrl) {
      throw new Error("❌ QUICKSWAP_API_URL is not defined in the .env file");
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `
          query {
            pools {
              id
              volumeUSD
              liquidity
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
      return;
    }

    const pools = data.data.pools;
    console.log("✅ Raw Data Fetched:", JSON.stringify(pools, null, 2));

    // Validate and filter pools
    const validatedPools = pools.filter((pool) => validatePool(pool));
    console.log("✅ Validated Pools:", validatedPools);

    // Save to file
    fs.writeFileSync("./logs/validated-quickswap-data.json", JSON.stringify(validatedPools, null, 2));
    console.log("✅ Data saved to logs/validated-quickswap-data.json");

    return validatedPools;
  } catch (error) {
    console.error("❌ Error fetching Quickswap data:", error);
  }
}

function validatePool(pool) {
  const requiredFields = ["id", "volumeUSD", "liquidity", "token0", "token1"];
  for (const field of requiredFields) {
    if (!pool[field]) {
      console.warn(`⚠️ Missing field: ${field} in pool ${pool.id}`);
      return false;
    }
  }
  return true;
}

// Execute the fetcher
(async () => {
  await fetchQuickswapData();
})();
