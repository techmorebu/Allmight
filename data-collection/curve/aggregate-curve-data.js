const fetchCurveMetaregistry = require("./fetch-curve-metaregistry");
const fetchCurveHistorical = require("./fetch-curve-historical");

async function aggregateCurveData(tokenAddress, poolAddress) {
  console.log("Aggregating Curve data...");

  // Fetch real-time data from Metaregistry
  const realTimeData = await fetchCurveMetaregistry(tokenAddress);

  // Fetch historical data from The Graph
  const historicalData = await fetchCurveHistorical(poolAddress);

  // Combine the data
  const aggregatedData = {
    tokenAddress,
    realTimeData,
    historicalData,
  };

  console.log("Aggregated Curve Data:", aggregatedData);
  return aggregatedData;
}

// Example Usage
if (require.main === module) {
  const DAI_TOKEN = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
  const POOL_ADDRESS = "0x...";
  aggregateCurveData(DAI_TOKEN, POOL_ADDRESS).then((data) =>
    console.log("Aggregated Curve Data:", data)
  );
}
