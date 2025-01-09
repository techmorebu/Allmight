const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
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
  const recursiveExtractor = (obj, parent = null) => {
    Object.keys(obj).forEach((key) => {
      const value = obj[key];
      fields.push({
        name: key,
        type: typeof value,
        parent,
      });
      if (typeof value === "object" && value !== null) {
        recursiveExtractor(value, key);
      }
    });
  };
  recursiveExtractor(data);
  return fields;
}

// Function to process schema and extract fields
function processSchema(types, apiName) {
  const fields = [];
  types.forEach((type) => {
    if (type.fields) {
      type.fields.forEach((field) => {
        fields.push({
          name: field.name,
          type: field.type.name || field.type.ofType?.name || "Unknown",
          kind: field.type.kind,
          api: apiName,
          parent: type.name,
        });
      });
    }
  });
  return fields;
}

// Save JSON output
function saveJsonOutput(fileName, data) {
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Output saved to ${filePath}`);
}

// Save CSV output
function saveCsvOutput(fileName, data) {
  const csvContent = data
    .map((row) =>
      Object.keys(row)
        .map((key) => `"${row[key]}"`)
        .join(",")
    )
    .join("\n");
  const csvFilePath = path.join(outputDir, fileName);
  fs.writeFileSync(csvFilePath, csvContent);
  console.log(`CSV Output saved to ${csvFilePath}`);
}

// Save HTML output
function saveHtmlOutput(fileName, data) {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Field Mapping Report</title>
        <style>
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; }
          th { background-color: #f4f4f4; text-align: left; }
        </style>
      </head>
      <body>
        <h1>Field Mapping Report</h1>
        <table>
          <tr>
            ${Object.keys(data[0])
              .map((key) => `<th>${key}</th>`)
              .join("")}
          </tr>
          ${data
            .map(
              (row) =>
                `<tr>${Object.values(row)
                  .map((value) => `<td>${value}</td>`)
                  .join("")}</tr>`
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

      saveJsonOutput(jsonFileName, fields);
      saveCsvOutput(csvFileName, fields);
      saveHtmlOutput(htmlFileName, fields);
    }
  }
  console.log("Field mapping completed for all APIs.");
}

// Schedule periodic updates (e.g., every day at midnight)
cron.schedule("0 0 * * *", runMapper);

// Initial run
runMapper();
