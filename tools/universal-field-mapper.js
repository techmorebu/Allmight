const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const queriesDir = path.join(outputDir, "queries");
const schemaAnalysisFile = path.join(outputDir, "schema-analysis.json");

// Map your API endpoints from .env
const apis = {
  uniswap: process.env.UNISWAP_DEX_API,
  sushiswap: process.env.SUSHISWAP_DEX_API,
  curveEthereum: process.env.CURVE_ETHEREUM_DEX_API,
  curveAvalanche: process.env.CURVE_AVALANCHE_DEX_API,
  quickswap: process.env.QUICKSWAP_DEX_API,
  balancerPolygon: process.env.BALANCER_POLYGON_DEX_API,
  balancerOptimism: process.env.BALANCER_OPTIMISM_DEX_API,
  balancerArbitrum: process.env.BALANCER_ARBITRUM_DEX_API,
  balancerAvalanche: process.env.BALANCER_AVALANCHE_DEX_API,
  balancerEthereum: process.env.BALANCER_ETHEREUM_DEX_API,
};

// Ensure output directories exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}
if (!fs.existsSync(queriesDir)) {
  fs.mkdirSync(queriesDir);
}

// Load schema analysis
const schemaAnalysis = JSON.parse(fs.readFileSync(schemaAnalysisFile));

// Critical fields to target
const criticalFields = ["liquidity", "volumeUSD", "feesUSD", "txCount", "token0", "token1", "priceUSD", "poolDayData", "poolHourData"];

// Generate queries dynamically for all APIs
function generateQueriesForAllAPIs() {
  Object.entries(schemaAnalysis).forEach(([apiName, types]) => {
    console.log(`Generating queries for API: ${apiName}`);
    const queries = {};

    types.forEach((type) => {
      const relevantFields = type.fields.filter((field) =>
        criticalFields.some((critical) => field.includes(critical))
      );

      if (relevantFields.length > 0) {
        queries[type.name] = `{
          ${type.name.toLowerCase()} {
            ${relevantFields.join(" ")}
          }
        }`;
      }
    });

    const queryFile = path.join(queriesDir, `${apiName}-queries.json`);
    fs.writeFileSync(queryFile, JSON.stringify(queries, null, 2));
    console.log(`Queries for ${apiName} saved at ${queryFile}`);
  });
}

// Generate and save queries
(async () => {
  try {
    generateQueriesForAllAPIs();
    console.log("Query generation completed for all APIs.");
  } catch (error) {
    console.error("Error during query generation:", error.message);
  }
})();
