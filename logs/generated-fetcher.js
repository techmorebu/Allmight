require("dotenv").config();
const fetch = require("node-fetch");

const schema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Unique identifier of the pool." },
    txCount: { type: "integer", description: "Total number of transactions in the pool." },
    volumeUSD: { type: "number", description: "Total trading volume in USD for the pool." },
    liquidity: { type: "number", description: "Current liquidity available in the pool." },
    token0: { type: "string", description: "Address of the first token in the pool." },
    token1: { type: "string", description: "Address of the second token in the pool." },
    token0Price: { type: "number", description: "Price of token0 in terms of token1." },
    token1Price: { type: "number", description: "Price of token1 in terms of token0." },
    feesUSD: { type: "number", description: "Total fees collected in USD." },
    createdAtTimestamp: {
      type: "string",
      format: "date-time",
      description: "Timestamp when the pool was created."
    },
    updatedAtTimestamp: {
      type: "string",
      format: "date-time",
      description: "Timestamp when the pool was last updated."
    }
  },
  required: ["id", "txCount", "volumeUSD", "liquidity", "token0", "token1"]
};

async function fetchData() {
  const apiUrl = process.env.QUICKSWAP_API_URL;

  try {
    console.log(`Fetching data from: ${apiUrl}`);
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `
          {
            pools {
              id
              txCount
              volumeUSD
              liquidity
              token0
              token1
              token0Price
              token1Price
              feesUSD
              createdAtTimestamp
              updatedAtTimestamp
            }
          }
        `
      })
    });

    const data = await response.json();
    if (data.errors) {
      console.error("Errors in response:", data.errors);
      return;
    }

    const pools = data.data.pools;
    const validatedPools = pools.filter(validateData);

    console.log("Validated Data:", JSON.stringify(validatedPools, null, 2));
    return validatedPools;
  } catch (error) {
    console.error("Error fetching data:", error);
  }
}

function validateData(pool) {
  const missingFields = schema.required.filter((field) => !(field in pool));
  if (missingFields.length > 0) {
    console.warn(`Pool ${pool.id} missing fields: ${missingFields.join(", ")}`);
    return false;
  }

  return true;
}

module.exports = fetchData;
