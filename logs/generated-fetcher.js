require("dotenv").config();
const fetch = require("node-fetch");

async function fetchData() {
  const apiUrl = process.env.API_URL;

  try {
    console.log(`Fetching data from: ${apiUrl}`);
    const query = `
      {
        pools {
          id
          volumeUSD
          txCount
          sqrtPrice
          tick
        }
      }
    `;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const json = await response.json();

    if (json.errors) {
      console.error("GraphQL Errors:", JSON.stringify(json.errors, null, 2));
      return [];
    }

    const data = json.data.pools.map((item) => ({
      id: item.id,
      volumeUSD: item.volumeUSD,
      txCount: item.txCount,
      sqrtPrice: item.sqrtPrice,
      tick: item.tick,
    }));

    console.log("Validated Data:", JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error("Error in fetchData:", error);
    return [];
  }
}

module.exports = fetchData;
