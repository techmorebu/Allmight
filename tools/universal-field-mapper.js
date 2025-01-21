const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const schemaDir = path.join(outputDir, "schemas");
const schemaAnalysisFile = path.join(schemaDir, "uniswap-schema-analysis.json");
const tableOutputDir = path.join(outputDir, "tables");

// Ensure output directories exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}
if (!fs.existsSync(schemaDir)) {
  fs.mkdirSync(schemaDir);
}
if (!fs.existsSync(tableOutputDir)) {
  fs.mkdirSync(tableOutputDir);
}

// Define Uniswap API endpoint
const uniswapApiUrl = process.env.UNISWAP_DEX_API;

// Function to fetch schema
async function fetchSchema(apiUrl, apiName) {
  const query = `{
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

// Function to analyze schema for relevant types and fields
function analyzeSchema(types) {
  const relevantTypes = [];

  types.forEach((type) => {
    if (type.kind === "OBJECT" && type.fields) {
      const relevantFields = type.fields.map((field) => ({
        name: field.name,
        description: field.description || "",
        type: field.type.name || field.type.ofType?.name || "Unknown",
        kind: field.type.kind || field.type.ofType?.kind || "Unknown",
      }));

      relevantTypes.push({
        name: type.name,
        kind: type.kind,
        fields: relevantFields,
      });
    }
  });

  return relevantTypes;
}

// Function to convert schema analysis into data tables
function generateDataTables(analysis) {
  const tables = {};

  analysis.forEach((type) => {
    const tableData = type.fields.map((field) => ({
      Type: type.name,
      Field: field.name,
      Description: field.description,
      FieldType: field.type,
      FieldKind: field.kind,
    }));
    tables[type.name] = tableData;
  });

  return tables;
}

// Save tables as JSON and CSV
function saveTables(tables) {
  Object.entries(tables).forEach(([typeName, rows]) => {
    const jsonFile = path.join(tableOutputDir, `${typeName}.json`);
    const csvFile = path.join(tableOutputDir, `${typeName}.csv`);

    fs.writeFileSync(jsonFile, JSON.stringify(rows, null, 2));
    console.log(`Table for ${typeName} saved as JSON at ${jsonFile}`);

    const csvData = rows.map((row) => Object.values(row).join(",")).join("\n");
    const csvHeaders = Object.keys(rows[0]).join(",");
    fs.writeFileSync(csvFile, `${csvHeaders}\n${csvData}`);
    console.log(`Table for ${typeName} saved as CSV at ${csvFile}`);
  });
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
  const analysisFile = path.join(schemaDir, "uniswap-analyzed-schema.json");
  fs.writeFileSync(analysisFile, JSON.stringify(analyzedSchema, null, 2));
  console.log(`Analyzed schema saved to ${analysisFile}`);

  const tables = generateDataTables(analyzedSchema);
  saveTables(tables);
}

// Run schema fetch and analysis
(async () => {
  try {
    await fetchAndAnalyzeSchema();
    console.log("Schema fetch and analysis completed.");
  } catch (error) {
    console.error("Error during schema fetch and analysis:", error.message);
  }
})();
