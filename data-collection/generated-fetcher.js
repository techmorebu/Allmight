require("dotenv").config();
const fetch = require("node-fetch");

async function fetchData() {
  const response = await fetch(process.env.NEW_DEX_API_URL);
  const data = await response.json();
  
  const validatedData = data.filter(item => validate(item));

  // Validation logic here
  
  return validatedData;
}

function validate(item) {
  const requiredFields = ["price", "volumeUSD", "liquidityUSD"];
  for (const field of requiredFields) {
    if (!item[field]) return false;
  }
  return true;
}

module.exports = fetchData;
