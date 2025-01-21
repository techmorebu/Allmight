const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const schemaDir = path.join(outputDir, "schemas");
const schemaConsolidatedFile = path.join(schemaDir, "consolidated-schema.json");

// Ensure output directories exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}
if (!fs.existsSync(schemaDir)) {
  fs.mkdirSync(schemaDir);
}

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

// Fetch and analyze API schema
async function fetchSchema(apiUrl, apiName) {
  const query = `{
    __schema {
      types {
        name
        kind
        fields {
          name
          type {
            name
            kind
            ofType {
              name
              kind
            }
          }
        }
      }
    }
  }`;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch schema for ${apiName}: ${response.statusText}`);
    }

    const data = await response.json();
    const schemaFile = path.join(schemaDir, `${apiName}-schema.json`);
    fs.writeFileSync(schemaFile, JSON.stringify(data, null, 2));
    console.log(`Schema saved for ${apiName} at ${schemaFile}`);

    return data.data.__schema.types;
  } catch (error) {
    console.error(`Error fetching schema for ${apiName}:`, error.message);
    return null;
  }
}

// Analyze schema for pools or liquidity structures
function analyzeSchemaForPools(types) {
  return types.filter((type) => {
    if (type.kind === "OBJECT" && type.fields) {
      const hasLiquidityOrPoolFields = type.fields.some((field) =>
        ["liquidity", "pool", "volume"].some((keyword) =>
          field.name.toLowerCase().includes(keyword)
        )
      );
      return hasLiquidityOrPoolFields;
    }
    return false;
  }).map((type) => ({
    name: type.name,
    fields: type.fields.map((field) => field.name),
  }));
}

// Fetch and analyze schemas for all APIs
async function analyzeAllSchemas() {
  const analysisResults = {};

  for (const [apiName, apiUrl] of Object.entries(apis)) {
    console.log(`Fetching and analyzing schema for API: ${apiName}`);
    const types = await fetchSchema(apiUrl, apiName);
    if (types) {
      const poolAnalysis = analyzeSchemaForPools(types);
      analysisResults[apiName] = poolAnalysis;
    }
  }

  const analysisFile = path.join(outputDir, "schema-analysis.json");
  fs.writeFileSync(analysisFile, JSON.stringify(analysisResults, null, 2));
  console.log(`Schema analysis saved at ${analysisFile}`);
}

// Run schema analysis
(async () => {
  try {
    await analyzeAllSchemas();
    console.log("Schema analysis completed.");
  } catch (error) {
    console.error("Error during schema analysis:", error.message);
  }
})();
