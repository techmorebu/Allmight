const fetch = require("node-fetch");
require("dotenv").config();

async function fetchCurveHistorical(poolAddress) {
  try {
    console.log(`Fetching historical data for Curve pool: ${poolAddress}...`);
    const query = `
    {
      pool(id: "${poolAddress}") {
        id
        token0 {
          symbol
        }
        token1 {
          symbol
        }
        volumeUSD
        liquidity
        feesUSD
        txCount
      }
    }`;

    const response = await fetch(process.env.CURVE_ETHEREUM_DEX_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();
    console.log("Fetched Historical Data:", data);
    return data.data.pool || null;
  } catch (error) {
    console.error("Error fetching Curve historical data:", error.message);
    return null;
  }
}

module.exports = fetchCurveHistorical;

// Example Usage
if (require.main === module) {
  const POOL_ADDRESS = "0x..."; // Replace with a valid pool address
  fetchCurveHistorical(POOL_ADDRESS).then((data) =>
    console.log("Fetched Curve Historical Data:", data)
  );
}
