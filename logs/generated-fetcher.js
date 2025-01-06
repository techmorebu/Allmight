require("dotenv").config();
const fetch = require("node-fetch");

async function fetchSmallQuery() {
  try {
    const apiUrl = process.env.API_URL;

    if (!apiUrl) {
      throw new Error("API_URL is not defined in the .env file");
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
            pools(first: 5) {
              id
              volumeUSD
              liquidity
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
          }
        `,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("✅ Fetched Data:", JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

fetchSmallQuery();
