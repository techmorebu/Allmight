const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
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

// Fetch schema and fields recursively
async function fetchGraphQLSchema(apiUrl) {
  const introspectionQuery = `{
    __schema {
      types {
        name
        kind
        fields {
          name
          description
          args {
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
      body: JSON.stringify({ query: introspectionQuery }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch schema: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data.__schema.types;
  } catch (error) {
    console.error(`Error fetching GraphQL schema: ${error.message}`);
    return null;
  }
}

// Recursive function to map fields
function recursiveMapFields(fields, parent = null, depth = 0) {
  const mappedFields = [];

  fields.forEach((field) => {
    mappedFields.push({
      name: field.name,
      type: field.type.name || field.type.ofType?.name || "Unknown",
      kind: field.type.kind,
      parent,
      depth,
      description: field.description || "N/A",
      args: field.args.map((arg) => ({
        name: arg.name,
        type: arg.type.name || arg.type.ofType?.name || "Unknown",
        description: arg.description || "N/A",
      })),
    });

    if (field.type.kind === "OBJECT" && field.type.fields) {
      mappedFields.push(...recursiveMapFields(field.type.fields, field.name, depth + 1));
    }
  });

  return mappedFields;
}

// Fetch and process data for each API
async function runMapper() {
  for (const [apiName, apiUrl] of Object.entries(apis)) {
    console.log(`Processing API: ${apiName}`);

    const schema = await fetchGraphQLSchema(apiUrl);
    if (!schema) {
      console.error(`Skipping ${apiName} due to schema fetch error.`);
      continue;
    }

    const relevantTypes = schema.filter((type) => type.kind === "OBJECT" && !type.name.startsWith("__"));
    const mappedData = [];

    relevantTypes.forEach((type) => {
      if (type.fields) {
        mappedData.push(...recursiveMapFields(type.fields, type.name));
      }
    });

    const dateStamp = new Date().toISOString().split("T")[0];
    const outputFile = path.join(outputDir, `${apiName}-fields-${dateStamp}.json`);

    fs.writeFileSync(outputFile, JSON.stringify(mappedData, null, 2));
    console.log(`Mapped fields saved to ${outputFile}`);
  }

  console.log("Field mapping completed for all APIs.");
}

// Run the mapper
runMapper();
