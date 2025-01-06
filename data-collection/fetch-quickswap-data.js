require("dotenv").config();
const fetch = require("node-fetch");

async function fetchData() {
  try {
    console.log("🚀 Starting fetcher script...");
    const apiUrl = process.env.QUICKSWAP_API; // Ensure this is set in your .env file

    if (!apiUrl) {
      throw new Error("❌ QUICKSWAP_API is not defined in the .env file");
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
        liquidity
token0Price
token1Price
tick
volumeToken0
volumeToken1
volumeUSD
untrackedVolumeUSD
feesUSD
txCount
      }
      tokens {
        volumeUSD
untrackedVolumeUSD
feesUSD
txCount
      }
    }
  

    if (!response.ok) {
      throw new Error(`❌ Failed to fetch data: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("✅ Fetched Data:", JSON.stringify(data, null, 2));

    if (data.errors) {
      console.error("❌ Errors in API response:", JSON.stringify(data.errors, null, 2));
      return;
    }

    const pools = data.data.pools || [];
    console.log("✅ Pools Data:", pools);

    return pools;
  } catch (error) {
    console.error("❌ Error in fetchData:", error);
  }
}

(async () => {
  await fetchData();
})();
