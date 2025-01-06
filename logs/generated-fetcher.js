
require("dotenv").config();
const fetch = require("node-fetch");

async function fetchData() {
  const response = await fetch(process.env.NEW_DEX_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `
      {
        pools {
          id
date
volumeMatic
volumeUSD
volumeUSDUntracked
feesUSD
txCount
tvlUSD
        }
      }
      `,
    }),
  });

  const data = await response.json();
  const validatedData = data.data.pools.filter((item) => validate(item));
  console.log("Validated Data:", JSON.stringify(validatedData, null, 2));
  return validatedData;
}

function validate(item) {
  const requiredFields = ["id","date","volumeMatic","volumeUSD","volumeUSDUntracked","feesUSD","txCount","tvlUSD"];
  for (const field of requiredFields) {
    if (!item[field]) return false;
  }
  return true;
}

module.exports = fetchData;
