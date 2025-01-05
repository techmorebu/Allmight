import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGS_DIR = path.join(__dirname, "../logs");
const RAW_DATA_FILE = path.join(LOGS_DIR, "raw-data.json");
const SCHEMA_FILE = path.join(LOGS_DIR, "generated-schema.json");
const FETCHER_FILE = path.join(LOGS_DIR, "generated-fetcher.js");

// Validator functions
function validate(item, schema) {
  const { properties, required } = schema;

  const missingFields = required.filter(field => !item[field]);
  if (missingFields.length > 0) {
    console.error(`Validation failed for item: ${JSON.stringify(item, null, 2)}`);
    console.error(`Missing fields: ${missingFields.join(", ")}`);
    return false;
  }

  for (const [field, definition] of Object.entries(properties)) {
    if (item[field] !== undefined && typeof item[field] !== definition.type) {
      console.error(`Field type mismatch for '${field}': expected '${definition.type}', got '${typeof item[field]}'`);
      return false;
    }
  }

  return true;
}

function generateValidationReport(items, schema) {
  let totalItems = items.length;
  let validItems = 0;
  let missingFieldStats = {};

  items.forEach(item => {
    const missingFields = schema.required.filter(field => !item[field]);
    if (missingFields.length === 0) {
      validItems++;
    } else {
      missingFields.forEach(field => {
        missingFieldStats[field] = (missingFieldStats[field] || 0) + 1;
      });
    }
  });

  console.log("Validation Report:");
  console.log(`Total items: ${totalItems}`);
  console.log(`Valid items: ${validItems} (${((validItems / totalItems) * 100).toFixed(2)}%)`);
  console.log("Most commonly missing fields:");
  console.table(
    Object.entries(missingFieldStats)
      .sort(([, countA], [, countB]) => countB - countA)
      .map(([field, count]) => ({ Field: field, MissingCount: count, Percentage: ((count / totalItems) * 100).toFixed(2) }))
  );
}

// Main function
async function main() {
  console.log(`🚀 Fetching schema for type: Pool from: ${process.env.NEW_DEX_API_URL}`);

  const schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, "utf8"));
  console.log("Loaded Schema:", JSON.stringify(schema, null, 2));

  console.log("Fetching raw data...");
  const response = await fetch(process.env.NEW_DEX_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: buildGraphQLQuery(schema) })
  });

  const rawData = await response.json();
  console.log("Raw Data Fetched:", JSON.stringify(rawData, null, 2));

  console.log("Validating data...");
  const validatedData = rawData.data.pools.filter(item => validate(item, schema));

  console.log("Validated Data:", JSON.stringify(validatedData, null, 2));

  generateValidationReport(rawData.data.pools, schema);
}

// Helper function to build GraphQL query dynamically
function buildGraphQLQuery(schema) {
  const fields = Object.keys(schema.properties).join(" ");
  return `{ pools { ${fields} } }`;
}

main().catch(error => {
  console.error("❌ Error:", error.message);
});
