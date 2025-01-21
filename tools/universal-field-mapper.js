const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const schemaDir = path.join(outputDir, "schemas");
const schemaConsolidatedFile = path.join(schemaDir, "consolidated-schema.json");
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

// Ensure schema directory exists
if (!fs.existsSync(schemaDir)) {
  fs.mkdirSync(schemaDir);
}

// Function to introspect and refine API schema
async function fetchAndRefineSchema(apiUrl, apiName) {
  const query = `{
    __schema {
      types {
        name
        fields {
          name
          description
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
    const refinedSchema = data.data.__schema.types.map((type) => {
      return {
        name: type.name,
        kind: type.kind,
        fields: type.fields ? type.fields.map((field) => ({
          name: field.name,
          description: field.description || "",
          type: field.type.name || (field.type.ofType ? field.type.ofType.name : "Unknown"),
          kind: field.type.kind,
        })) : [],
      };
    });

    const schemaFile = path.join(schemaDir, `${apiName}-refined-schema.json`);
    fs.writeFileSync(schemaFile, JSON.stringify(refinedSchema, null, 2));
    console.log(`Refined schema saved for ${apiName} at ${schemaFile}`);
    return refinedSchema;
  } catch (error) {
    console.error(`Error refining schema for ${apiName}:`, error.message);
    return null;
  }
}

// Consolidate all refined schemas into a single file
async function consolidateSchemas() {
  const consolidatedSchema = {};

  for (const [apiName, apiUrl] of Object.entries(apis)) {
    console.log(`Refining schema for ${apiName}`);
    const refinedSchema = await fetchAndRefineSchema(apiUrl, apiName);
    if (refinedSchema) {
      consolidatedSchema[apiName] = refinedSchema;
    }
  }

  fs.writeFileSync(schemaConsolidatedFile, JSON.stringify(consolidatedSchema, null, 2));
  console.log(`Consolidated refined schema saved at ${schemaConsolidatedFile}`);
}

// Run schema refinement and consolidation
(async () => {
  try {
    await consolidateSchemas();
  } catch (error) {
    console.error("Error during schema refinement:", error.message);
  }
})();
