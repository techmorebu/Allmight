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
  curve: process.env.CURVE_DEX_API,
  sushiswap: process.env.SUSHISWAP_DEX_API,
  // Add more APIs as needed
};

// Helper function to fetch schema or data
async function fetchApiSchema(apiName, apiUrl) {
  try {
    console.log(`Fetching schema for ${apiName}...`);
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
                  }
                }
              }
            }
          }
        }`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch schema for ${apiName}: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.errors) {
      throw new Error(`API Error: ${data.errors[0].message}`);
    }

    return data.data.__schema.types;
  } catch (error) {
    console.error(`Error fetching schema for ${apiName}:`, error.message);
    return null;
  }
}

// Function to process schema and extract fields
function processSchema(types) {
  const fields = [];
  types.forEach((type) => {
    if (type.fields) {
      type.fields.forEach((field) => {
        fields.push({
          name: field.name,
          type: field.type.name || field.type.ofType?.name || "Unknown",
          kind: field.type.kind,
        });
      });
    }
  });
  return fields;
}

// Main function to run the mapper
async function runMapper() {
  for (const [apiName, apiUrl] of Object.entries(apis)) {
    const schema = await fetchApiSchema(apiName, apiUrl);
    if (schema) {
      const fields = processSchema(schema);

      // Save fields to JSON file
      const outputFilePath = path.join(outputDir, `${apiName}-fields-${new Date().toISOString().split("T")[0]}.json`);
      fs.writeFileSync(outputFilePath, JSON.stringify(fields, null, 2));
      console.log(`Schema for ${apiName} saved to ${outputFilePath}`);
    }
  }
  console.log("Field mapping completed for all APIs.");
}

// Run the script
runMapper();
