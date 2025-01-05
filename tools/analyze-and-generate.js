const fs = require("fs");
const fetch = require("node-fetch");
const path = require("path");

const LOGS_DIR = path.join(__dirname, "../logs");
const SCHEMA_FILE = path.join(LOGS_DIR, "generated-schema.json");
const RAW_DATA_FILE = path.join(LOGS_DIR, "raw-data.json");

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

async function fetchSchemaAndData() {
  console.log(`🚀 Fetching data from: ${process.env.NEW_DEX_API_URL}`);
  
  const response = await fetch(process.env.NEW_DEX_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: `{ pools { id volumeUSD txCount } }` })
  });

  const rawData = await response.json();

  fs.writeFileSync(RAW_DATA_FILE, JSON.stringify(rawData, null, 2));
  console.log("✅ Raw data saved to:", RAW_DATA_FILE);

  return rawData;
}

async function main() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, "utf8"));
  console.log("Loaded Schema:", JSON.stringify(schema, null, 2));

  const rawData = await fetchSchemaAndData();

  const validatedData = rawData.data.pools.filter(item => validate(item, schema));
  console.log("Validated Data:", JSON.stringify(validatedData, null, 2));

  fs.writeFileSync(
    path.join(LOGS_DIR, "validation-report.json"),
    JSON.stringify({ validatedData }, null, 2)
  );
  console.log("✅ Validation report saved!");
}

main().catch(error => console.error("❌ Error:", error.message));
