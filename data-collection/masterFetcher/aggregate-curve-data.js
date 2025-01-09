const fetchCurveMetaregistry = require("./fetch-curve-metaregistry");
const fetchCurveHistorical = require("./fetch-curve-historical");

async function aggregateCurveData(tokenAddress, poolAddress) {
  console.log("Aggregating Curve data...");

  const realTimeData = await fetchCurveMetaregistry(tokenAddress);
  const historicalData = await fetchCurveHistorical(poolAddress);

  const aggregatedData = {
    tokenAddress,
    realTimeData,
    historicalData,
  };

  console.log("Aggregated Curve Data:", aggregatedData);
  return aggregatedData;
}

module.exports = aggregateCurveData;

// Example Usage
if (require.main === module) {
  const DAI_TOKEN = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
  const POOL_ADDRESS = "0x..."; // Replace with a valid pool address
  aggregateCurveData(DAI_TOKEN, POOL_ADDRESS).then((data) =>
    console.log("Aggregated Curve Data:", data)
  );
}
