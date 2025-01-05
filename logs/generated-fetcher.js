
require("dotenv").config();
const fetch = require("node-fetch");

async function fetchData() {
  const response = await fetch("https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g");
  const data = await response.json();
  
  const validatedData = data.filter(item => validate(item));

  // Validation logic here
  
  return validatedData;
}

function validate(item) {
  const requiredFields = ["price","volumeUSD","liquidityUSD"];
  for (const field of requiredFields) {
    if (!item[field]) return false;
  }
  return true;
}

module.exports = fetchData;
