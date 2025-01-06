require("dotenv").config();
const fetch = require("node-fetch");

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection:", reason);
});

async function fetchData() {
  try {
    console.log("🚀 Starting comprehensive fetcher...");
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
            pools(first: 10) {
              id
              token0 {
                id
                symbol
                name
              }
              token1 {
                id
                symbol
                name
              }
              volumeUSD
              liquidity
              feesUSD
              sqrtPrice
              tick
              totalValueLockedUSD
              swaps(first: 5) {
                id
                timestamp
                sender
                recipient
                amountUSD
              }
            }
            tokens(first: 10) {
              id
              symbol
              name
              volumeUSD
              tokenDayData(first: 3) {
                date
                priceUSD
                volumeUSD
              }
            }
            swaps(first: 10, orderBy: timestamp, orderDirection: desc) {
              id
              timestamp
              sender
              recipient
              amountUSD
              token0 {
                id
                symbol
                name
              }
              token1 {
                id
                symbol
                name
              }
            }
            transactions(first: 10, orderBy: timestamp, orderDirection: desc) {
              id
              blockNumber
              timestamp
              gasPrice
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

    const results = data.data;
    console.log("✅ Processed Data:", JSON.stringify(results, null, 2));

    return results;
  } catch (error) {
    console.error("❌ Error in fetchData:", error);
  }
}

(async () => {
  try {
    await fetchData();
  } catch (error) {
    console.error("❌ Uncaught error in script:", error);
  }
})();
