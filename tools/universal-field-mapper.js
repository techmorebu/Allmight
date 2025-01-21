const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const schemaDir = path.join(outputDir, "schemas");
const consolidatedFile = path.join(outputDir, "consolidated-fields.json");
const rawDataFile = path.join(outputDir, "raw-data.json");
const TRANSACTION_THRESHOLD = 200;
const VOLUME_THRESHOLD = 50000;

// Ensure output and schema directories exist
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

// Function to introspect API schema
async function fetchSchema(apiUrl, apiName) {
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
    const schemaFile = path.join(schemaDir, `${apiName}-schema.json`);
    fs.writeFileSync(schemaFile, JSON.stringify(data, null, 2));
    console.log(`Schema saved for ${apiName} at ${schemaFile}`);
  } catch (error) {
    console.error(`Error fetching schema for ${apiName}:`, error.message);
  }
}

// Fetch schema for all APIs
async function fetchAllSchemas() {
  for (const [apiName, apiUrl] of Object.entries(apis)) {
    console.log(`Fetching schema for ${apiName}`);
    await fetchSchema(apiUrl, apiName);
  }
}

// Fetch pool data dynamically using saved schemas
async function fetchDynamicPoolData(apiUrl, apiName, poolId) {
  const schemaFile = path.join(schemaDir, `${apiName}-schema.json`);

  if (!fs.existsSync(schemaFile)) {
    console.warn(`Schema not found for ${apiName}, skipping.`);
    return null;
  }

  const schema = JSON.parse(fs.readFileSync(schemaFile));
  const poolFields = schema.data.__schema.types
    .find((type) => type.name === "Pool")?.fields
    .map((field) => field.name)
    .join(" ");

  if (!poolFields) {
    console.warn(`No pool fields found in schema for ${apiName}, skipping.`);
    return null;
  }

  const query = `{
    pool(id: "${poolId}") {
      ${poolFields}
    }
  }`;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch pool data for ${poolId} from ${apiName}: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data.pool;
  } catch (error) {
    console.error(`Error fetching pool data for ${poolId} from ${apiName}:`, error.message);
    return null;
  }
}

// Fetch and process data for each API
async function runMapper() {
  const consolidatedData = [];

  for (const [apiName, apiUrl] of Object.entries(apis)) {
    console.log(`Processing API: ${apiName}`);

    // Dynamically fetch schema if not already fetched
    await fetchSchema(apiUrl, apiName);

    // Placeholder pool IDs for demonstration
    const poolIds = ["POOL_ID_1", "POOL_ID_2", "POOL_ID_3"];
    const validPools = [];

    for (const poolId of poolIds) {
      const poolData = await fetchDynamicPoolData(apiUrl, apiName, poolId);
      if (poolData) {
        validPools.push(poolData);
      }
    }

    consolidatedData.push({
      apiName,
      timestamp: new Date().toISOString(),
      pools: validPools,
    });

    console.log(`Processed pools for ${apiName}:`, validPools);
  }

  // Save consolidated output
  fs.writeFileSync(consolidatedFile, JSON.stringify(consolidatedData, null, 2));
  console.log(`Consolidated output saved to ${consolidatedFile}`);
}

// Run schema fetching and mapper
(async () => {
  await fetchAllSchemas();
  await runMapper();
})();
