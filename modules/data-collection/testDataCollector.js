const { fetchPriceData } = require("./dataCollector");

async function testFetchPriceData() {
  const data = await fetchPriceData("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
  console.log("Price Data:", data);
}

testFetchPriceData();
