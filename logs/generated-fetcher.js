require("dotenv").config();
const fetch = require("node-fetch");

async function fetchData() {
  try {
    console.log("Fetching data from:", process.env.NEW_DEX_API_URL);

    const query = process.env.NEW_DEX_QUERY; // Fetch the query from .env
    if (!query) {
      console.error("Error: No GraphQL query provided in NEW_DEX_QUERY.");
      return;
    }

    const response = await fetch(process.env.NEW_DEX_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    });

    if (!response.ok) {
      console.error("Failed to fetch data:", response.statusText);
      return;
    }

    const data = await response.json();
    console.log("Raw Data Fetched:", JSON.stringify(data, null, 2));

    const validatedData = data.data.pools.filter(item => validate(item));
    console.log("Validated Data:", JSON.stringify(validatedData, null, 2));

    return validatedData;
  } catch (error) {
    console.error("Error in fetchData:", error);
  }
}

function validate(item) {
  const requiredFields = ["id", "volumeUSD", "liquidityUSD"];
  for (const field of requiredFields) {
    if (!item[field]) {
      console.warn(`Skipping item due to missing field: ${field}`);
      return false;
    }
  }
  return true;
}

fetchData();
