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
            pools(first: 1000, orderBy: volumeUSD, orderDirection: desc) {
              id
              liquidity
              volumeUSD
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
    console.log("✅ Raw Data Fetched:", JSON.stringify(data, null, 2));

    if (data.errors) {
      console.error("❌ Errors in API response:", JSON.stringify(data.errors, null, 2));
      return;
    }

    const pools = data.data.pools;
    if (!pools || pools.length === 0) {
      console.log("⚠️ No pools data found");
      return;
    }

    const fs = require("fs");
    fs.writeFileSync("./logs/filtered-pools.json", JSON.stringify(pools, null, 2));
    console.log("✅ Data saved to ./logs/filtered-pools.json");
  } catch (error) {
    console.error("❌ Error in fetchData:", error);
  }
}

// Execute the fetcher
(async () => {
  try {
    await fetchData();
  } catch (error) {
    console.error("❌ Uncaught error in script:", error);
  }
})();
