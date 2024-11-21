const fetch = require("node-fetch");

async function fetchPriceData(url) {
  try {
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching price data:", error);
    return null;
  }
}

module.exports = { fetchPriceData };
