const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const outputsDir = path.resolve(__dirname, "../outputs");
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

const apis = {
  uniswap: process.env.UNISWAP_DEX_API,
  sushiswap: process.env.SUSHISWAP_DEX_API,
  curveEthereum: process.env.CURVE_ETHEREUM_DEX_API,
  curveAvalanche: process.env.CURVE_AVALANCHE_DEX_API,
};

async function fetchApiSchema(apiName, apiUrl) {
  console.log(`Fetching schema for ${apiName} (${apiUrl})...`);
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `{
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
                    ofType {
                      name
                      kind
                    }
                  }
                }
              }
            }
          }
        }`,
      }),
    });

    if (!response.ok) throw new Error(`Failed to fetch schema: ${response.statusText}`);
    const data = await response.json();
    return { schema: data.data.__schema.types };
  } catch (error) {
    console.error(`Error fetching schema for ${apiName}:`, error.message);
    return { schema: null, error: error.message };
  }
}

function extractNestedFields(schema) {
  const fields = [];

  function recurse(type) {
    if (!type || !type.fields) return;
    type.fields.forEach((field) => {
      fields.push(field.name);
      if (field.type?.ofType) {
        recurse(field.type.ofType);
      }
    });
  }

  schema.forEach((type) => {
    recurse(type);
  });

  return fields;
}

async function runMapper() {
  console.log("Running Universal Mapper...");
  for (const [apiName, apiUrl] of Object.entries(apis)) {
    const { schema, error } = await fetchApiSchema(apiName, apiUrl);
    const fields = schema ? extractNestedFields(schema) : [];
    const outputPath = path.join(outputsDir, `${apiName}-fields.json`);
    fs.writeFileSync(outputPath, JSON.stringify({ fields, error }, null, 2));
    console.log(`Saved fields for ${apiName} to ${outputPath}`);
  }
}

module.exports = { runMapper };
