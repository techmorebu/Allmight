require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");

async function fetchRawData(apiUrl, query = null) {
  const options = query
    ? {
        method: "POST",
        body: JSON.stringify({ query }),
        headers: { "Content-Type": "application/json" },
      }
    : { method: "GET" };

  const response = await fetch(apiUrl, options);
  const data = await response.json();
  fs.writeFileSync("raw-data.json", JSON.stringify(data, null, 2));
  console.log("✅ Raw data saved to raw-data.json");
  return data;
}

function analyzeRawData(data) {
  const fieldAnalysis = {};

  function analyzeObject(obj, parent = "") {
    for (const key in obj) {
      const fieldPath = parent ? `${parent}.${key}` : key;
      const value = obj[key];

      if (!fieldAnalysis[fieldPath]) {
        fieldAnalysis[fieldPath] = { type: typeof value, examples: [] };
      }

      if (!fieldAnalysis[fieldPath].examples.includes(value)) {
        fieldAnalysis[fieldPath].examples.push(value);
      }

      if (value && typeof value === "object" && !Array.isArray(value)) {
        analyzeObject(value, fieldPath);
      }
    }
  }

  analyzeObject(data);
  fs.writeFileSync("field-analysis.json", JSON.stringify(fieldAnalysis, null, 2));
  console.log("✅ Field analysis saved to field-analysis.json");
}

function generateSchema(fieldAnalysis) {
  const schema = {
    type: "object",
    properties: {
      price: { type: "number", description: "Current price of the asset" },
      volumeUSD: { type: "number", description: "Total trading volume in USD" },
      txCount: { type: "integer", description: "Number of transactions" },
      liquidityUSD: { type: "number", description: "Total liquidity in USD" },
      swapFee: { type: "number", description: "Trading fee percentage" },
      priceImpact: { type: "number", description: "Impact on price for large trades" },
      metadata: {
        type: "object",
        description: "Additional fields for future use",
        additionalProperties: true,
      },
    },
    required: ["price", "volumeUSD", "liquidityUSD"],
  };

  for (const field in fieldAnalysis) {
    if (!schema.properties[field]) {
      schema.properties.metadata.properties[field] = {
        type: fieldAnalysis[field].type,
        description: `Dynamic field: ${field}`,
      };
    }
  }

  fs.writeFileSync("generated-schema.json", JSON.stringify(schema, null, 2));
  console.log("✅ Schema saved to generated-schema.json");
}

function generateFetcher(schemaPath, apiUrl) {
  const schema = require(schemaPath);
  const fetcherTemplate = `
require("dotenv").config();
const fetch = require("node-fetch");

async function fetchData() {
  const response = await fetch("${apiUrl}");
  const data = await response.json();
  
  const validatedData = data.filter(item => validate(item));

  // Validation logic here
  
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

  fs.writeFileSync("generated-fetcher.js", fetcherTemplate);
  console.log("✅ Fetcher template saved to generated-fetcher.js");
}

(async () => {
  const apiUrl = process.env.NEW_DEX_API_URL;
  const query = process.env.NEW_DEX_QUERY || null;

  console.log("🚀 Fetching raw data...");
  const rawData = await fetchRawData(apiUrl, query);

  console.log("🔍 Analyzing raw data...");
  analyzeRawData(rawData);

  console.log("🛠 Generating schema...");
  const fieldAnalysis = require("./field-analysis.json");
  generateSchema(fieldAnalysis);

  console.log("📜 Creating fetcher...");
  generateFetcher("./generated-schema.json", apiUrl);

  console.log("🎉 All tasks completed successfully!");
})();
