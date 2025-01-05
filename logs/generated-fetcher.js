require("dotenv").config();
const fetch = require("node-fetch");

async function fetchData() {
  try {
    console.log("Fetching data from:", process.env.NEW_DEX_API_URL);
    const response = await fetch(process.env.NEW_DEX_API_URL);
    const data = await response.json();
    console.log("Raw Data:", JSON.stringify(data, null, 2));

    const validatedData = data.filter(item => validate(item));
    console.log("Validated Data:", JSON.stringify(validatedData, null, 2));

    return validatedData;
  } catch (error) {
    console.error("Error in fetchData:", error);
  }
}

function validate(item) {
  const requiredFields = ["price", "volumeUSD", "liquidityUSD"];
  for (const field of requiredFields) {
    if (!item[field]) {
      console.error("Missing field: " + field);
      return false;
    }
  }
  return true;
}

module.exports = fetchData;