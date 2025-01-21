const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const schemaDir = path.join(outputDir, "schemas");
const schemaAnalysisFile = path.join(schemaDir, "uniswap-schema-analysis.json");

// Ensure output directories exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}
if (!fs.existsSync(schemaDir)) {
  fs.mkdirSync(schemaDir);
}

// Define Uniswap API endpoint
const uniswapApiUrl = process.env.UNISWAP_DEX_API;

// GraphQL introspection query
const introspectionQuery = `{
  __schema {
    types {
      name
      kind
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

// Function to fetch schema
async function fetchSchema(apiUrl, apiName) {
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: introspectionQuery }),
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

// Function to analyze schema for relevant types and fields
function analyzeSchema(types) {
  const relevantTypes = [];

  types.forEach((type) => {
    if (type.kind === "OBJECT" && type.fields) {
      const relevantFields = type.fields.filter((field) =>
        ["pool", "swap", "liquidity", "volume", "token"].some((keyword) =>
          field.name.toLowerCase().includes(keyword)
        )
      );

      if (relevantFields.length > 0) {
        relevantTypes.push({
          name: type.name,
          fields: relevantFields.map((field) => field.name),
        });
      }
    }
  });

  return relevantTypes;
}

// Main function to fetch and analyze schema
async function fetchAndAnalyzeSchema() {
  console.log("Fetching and analyzing schema for Uniswap...");

  const types = await fetchSchema(uniswapApiUrl, "uniswap");
  if (!types) {
    console.error("Failed to fetch schema. Exiting...");
    return;
  }

  const analyzedSchema = analyzeSchema(types);
  fs.writeFileSync(schemaAnalysisFile, JSON.stringify(analyzedSchema, null, 2));
  console.log(`Analyzed schema saved to ${schemaAnalysisFile}`);
}

// Run the schema fetch and analysis
(async () => {
  try {
    await fetchAndAnalyzeSchema();
    console.log("Schema fetch and analysis completed.");
  } catch (error) {
    console.error("Error during schema fetch and analysis:", error.message);
  }
})();
