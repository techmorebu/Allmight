const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const schemaDir = path.join(outputDir, "schemas");
const queriesDir = path.join(outputDir, "queries");
const schemaConsolidatedFile = path.join(schemaDir, "consolidated-schema.json");

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
if (!fs.existsSync(schemaDir)) {
  fs.mkdirSync(schemaDir);
}
if (!fs.existsSync(queriesDir)) {
  fs.mkdirSync(queriesDir);
}

// Load consolidated schema
const consolidatedSchema = JSON.parse(fs.readFileSync(schemaConsolidatedFile));

// Generate queries dynamically for each API and type
function generateQueries(apiName) {
  const schema = consolidatedSchema[apiName];
  if (!schema) {
    console.warn(`Schema not found for API: ${apiName}`);
    return;
  }

  const queries = {};

  schema.forEach((type) => {
    if (type.kind === "OBJECT" && type.fields && type.fields.length > 0) {
      const fields = type.fields.map((field) => field.name).join(" ");
      queries[type.name] = `{
        ${type.name.toLowerCase()} {
          ${fields}
        }
      }`;
    }
  });

  const queryFile = path.join(queriesDir, `${apiName}-queries.json`);
  fs.writeFileSync(queryFile, JSON.stringify(queries, null, 2));
  console.log(`Generated queries saved for ${apiName} at ${queryFile}`);
}

// Generate queries for all APIs
async function generateAllQueries() {
  Object.keys(consolidatedSchema).forEach((apiName) => {
    console.log(`Generating queries for API: ${apiName}`);
    generateQueries(apiName);
  });
}

// Refine schema and generate queries
(async () => {
  try {
    await generateAllQueries();
    console.log("Dynamic query generation completed.");
  } catch (error) {
    console.error("Error during query generation:", error.message);
  }
})();
