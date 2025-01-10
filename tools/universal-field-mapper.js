const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const aggregatedOutputFile = path.join(outputDir, "aggregated-fields.json");

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

// Helper function to fetch schema or data
async function fetchApiSchema(apiName, apiUrl) {
  if (!apiUrl) {
    console.error(`Error: API URL for ${apiName} is not defined.`);
    return null;
  }

  try {
    console.log(`Fetching schema for ${apiName}...`);
    const isGraphQL = apiUrl.includes("thegraph");
    const options = isGraphQL
      ? {
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
        }
      : null;

    const response = await fetch(apiUrl, options);
    if (!response.ok) {
      throw new Error(`Failed to fetch schema for ${apiName}: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.errors) {
      throw new Error(`API Error: ${data.errors[0].message}`);
    }

    return isGraphQL ? data.data.__schema.types : processRestApiSchema(data);
  } catch (error) {
    console.error(`Error fetching schema for ${apiName}:`, error.message);
    return null;
  }
}

// Helper function to process REST API schema
function processRestApiSchema(data) {
  const fields = [];
  const recursiveExtractor = (obj, parent = null, depth = 0) => {
    Object.keys(obj).forEach((key) => {
      const value = obj[key];
      fields.push({
        name: key,
        type: typeof value,
        parent,
        depth,
        description: null // Placeholder for descriptions if available
      });
      if (typeof value === "object" && value !== null) {
        recursiveExtractor(value, key, depth + 1);
      }
    });
  };
  recursiveExtractor(data);
  return fields;
}

// Function to process schema and extract fields
function processSchema(types, apiName) {
  const fields = [];
  const extractFields = (type, parent = null, depth = 0) => {
    if (type.fields) {
      type.fields.forEach((field) => {
        fields.push({
          name: field.name,
          type: field.type.name || field.type.ofType?.name || "Unknown",
          kind: field.type.kind,
          parent,
          depth,
          description: field.description || null,
          api: apiName
        });
        if (field.type.kind === "OBJECT" && field.type.fields) {
          extractFields(field.type, field.name, depth + 1);
        }
      });
    }
  };
  types.forEach((type) => extractFields(type));
  return fields;
}

// Save JSON output
function saveJsonOutput(fileName, data, apiName) {
  const filePath = path.join(outputDir, fileName);
  const outputData = {
    metadata: {
      apiName,
      timestamp: new Date().toISOString(),
      totalFields: data.length,
    },
    fields: data,
  };
  fs.writeFileSync(filePath, JSON.stringify(outputData, null, 2));
  console.log(`JSON Output saved to ${filePath}`);
}

// Save aggregated JSON output
function saveAggregatedOutput(apiName, data) {
  let aggregatedData = [];
  if (fs.existsSync(aggregatedOutputFile)) {
    aggregatedData = JSON.parse(fs.readFileSync(aggregatedOutputFile, "utf-8"));
  }
  aggregatedData.push({
    apiName,
    timestamp: new Date().toISOString(),
    fields: data
  });
  fs.writeFileSync(aggregatedOutputFile, JSON.stringify(aggregatedData, null, 2));
  console.log(`Aggregated output updated at ${aggregatedOutputFile}`);
}

// Save CSV output with headers
function saveCsvOutput(fileName, data, apiName) {
  const headers = ["Field Name", "Type", "Parent", "Depth", "API", "Description"];
  const csvContent = [
    headers.join(","),
    ...data.map((row) =>
      [row.name, row.type, row.parent, row.depth, apiName, row.description || ""].map((value) => `"${value}"`).join(",")
    ),
  ].join("\n");

  const csvFilePath = path.join(outputDir, fileName);
  fs.writeFileSync(csvFilePath, csvContent);
  console.log(`CSV Output saved to ${csvFilePath}`);
}

// Save HTML output with navigation and summaries
function saveHtmlOutput(fileName, data, apiName) {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Field Mapping Report for ${apiName}</title>
        <style>
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; }
          th { background-color: #f4f4f4; text-align: left; }
        </style>
      </head>
      <body>
        <h1>Field Mapping Report for ${apiName}</h1>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        <p><strong>Total Fields:</strong> ${data.length}</p>
        <table>
          <tr>
            <th>Field Name</th>
            <th>Type</th>
            <th>Parent</th>
            <th>Depth</th>
            <th>API</th>
            <th>Description</th>
          </tr>
          ${data
            .map(
              (row) =>
                `<tr><td>${row.name}</td><td>${row.type}</td><td>${row.parent}</td><td>${row.depth}</td><td>${apiName}</td><td>${row.description || "N/A"}</td></tr>`
            )
            .join("")}
        </table>
      </body>
    </html>
  `;
  const htmlFilePath = path.join(outputDir, fileName);
  fs.writeFileSync(htmlFilePath, htmlContent);
  console.log(`HTML Output saved to ${htmlFilePath}`);
}

// Main function to run the mapper
async function runMapper() {
  for (const [apiName, apiUrl] of Object.entries(apis)) {
    const schema = await fetchApiSchema(apiName, apiUrl);
    if (schema) {
      const fields = Array.isArray(schema)
        ? processSchema(schema, apiName)
        : schema;

      const dateStamp = new Date().toISOString().split("T")[0];
      const jsonFileName = `${apiName}-fields-${dateStamp}.json`;
      const csvFileName = `${apiName}-fields-${dateStamp}.csv`;
      const htmlFileName = `${apiName}-fields-${dateStamp}.html`;

      saveJsonOutput(jsonFileName, fields, apiName);
      saveCsvOutput(csvFileName, fields, apiName);
      saveHtmlOutput(htmlFileName, fields, apiName);
      saveAggregatedOutput(apiName, fields);
    }
  }
  console.log("Field mapping completed for all APIs.");
}

// Schedule periodic updates (e.g., every day at midnight)
cron.schedule("0 0 * * *", runMapper);

// Initial run
runMapper();
