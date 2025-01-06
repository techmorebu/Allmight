require("dotenv").config();
const fetch = require("node-fetch");

async function fetchQuickswapData() {
  try {
    console.log("🚀 Fetching data from Quickswap...");
    const apiUrl = process.env.API_URL;

    if (!apiUrl) {
      throw new Error("❌ API_URL is not defined in the .env file");
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
      console.error("❌ Errors in API response:", data.errors);
      return;
    }

    console.log("✅ Fetched Data:", JSON.stringify(data, null, 2));
    return data.data.pools;
  } catch (error) {
    console.error("❌ Error fetching Quickswap data:", error);
  }
}

// Execute the fetcher
(async () => {
  await fetchQuickswapData();
})();
