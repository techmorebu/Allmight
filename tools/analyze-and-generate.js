require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");

const API_URL = process.env.NEW_DEX_API_URL;
const DEFAULT_QUERY = `
{
  __schema {
    types {
      name
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
}
`;

async function fetchRawData() {
  try {
    console.log(`🚀 Fetching raw data from: ${API_URL}`);
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: DEFAULT_QUERY }),
    });
    const rawData = await response.json();

    const rawFilePath = "./logs/raw-data.json";
    fs.writeFileSync(rawFilePath, JSON.stringify(rawData, null, 2));
    console.log(`✅ Raw data saved to: ${rawFilePath}`);
    return rawData;
  } catch (error) {
    console.error("❌ Error fetching raw data:", error);
    return null;
  }
}

function analyzeSchema(rawData) {
  try {
    console.log("🔍 Analyzing raw schema...");
    const types = rawData?.data?.__schema?.types || [];
    const analyzedFields = {};

    types.forEach((type) => {
      if (type.fields) {
        analyzedFields[type.name] = type.fields.map((field) => ({
          name: field.name,
          type: field.type.name || field.type.ofType?.name,
          kind: field.type.kind || field.type.ofType?.kind,
        }));
      }
    });

    const analysisFilePath = "./logs/field-analysis.json";
    fs.writeFileSync(analysisFilePath, JSON.stringify(analyzedFields, null, 2));
    console.log(`✅ Field analysis saved to: ${analysisFilePath}`);
    return analyzedFields;
  } catch (error) {
    console.error("❌ Error analyzing schema:", error);
    return null;
  }
}

function generateSchema(selectedFields) {
  console.log("🛠 Generating schema...");
  const schema = {
    type: "object",
    properties: {},
    required: [],
  };

  selectedFields.forEach((field) => {
    schema.properties[field.name] = {
      type: field.type.toLowerCase(),
      description: `Field of type ${field.type}`,
    };
    schema.required.push(field.name);
  });

  const schemaFilePath = "./logs/generated-schema.json";
  fs.writeFileSync(schemaFilePath, JSON.stringify(schema, null, 2));
  console.log(`✅ Schema saved to: ${schemaFilePath}`);
  return schema;
}

function generateFetcherTemplate(schema) {
  console.log("📜 Creating fetcher...");
  const template = `
require("dotenv").config();
const fetch = require("node-fetch");

async function fetchData() {
  const response = await fetch(process.env.NEW_DEX_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: \`
      {
        pools {
          ${schema.required.join("\n")}
        }
      }
      \`,
    }),
  });

  const data = await response.json();
  const validatedData = data.data.pools.filter((item) => validate(item));
  console.log("Validated Data:", JSON.stringify(validatedData, null, 2));
  return validatedData;
}

function validate(item) {
  const requiredFields = ${JSON.stringify(schema.required)};
  for (const field of requiredFields) {
    if (!item[field]) return false;
  }
  return true;
}

module.exports = fetchData;
`;

  const fetcherFilePath = "./logs/generated-fetcher.js";
  fs.writeFileSync(fetcherFilePath, template);
  console.log(`✅ Fetcher template saved to: ${fetcherFilePath}`);
}

async function main() {
  const rawData = await fetchRawData();
  if (!rawData) return;

  const analyzedFields = analyzeSchema(rawData);
  if (!analyzedFields) return;

  console.log("⚙️ Fields detected. Select fields to include:");
  console.table(analyzedFields);

  // Replace this array with dynamically selected fields as needed
  const selectedFields = Object.values(analyzedFields)[0]; // Default to the first detected type for demo

  const schema = generateSchema(selectedFields);
  generateFetcherTemplate(schema);

  console.log("🎉 All tasks completed successfully!");
}

main();
