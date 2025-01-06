require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

// Priority fields for arbitrage and scalping
const PRIORITY_FIELDS = [
  "token0Price",
  "token1Price",
  "volumeUSD",
  "volumeToken0",
  "volumeToken1",
  "liquidity",
  "liquidityGross",
  "liquidityNet",
  "txCount",
  "feesUSD",
  "open",
  "high",
  "low",
  "close",
  "tick",
  "price0",
  "price1",
  "tickLower",
  "tickUpper",
  "untrackedVolumeUSD",
  "gasPrice",
  "gasLimit",
];

const API_URL = process.env.API_URL || "https://your-api-url/graphql";

async function fetchSchema() {
  console.log("🚀 Fetching schema...");
  const introspectionQuery = `
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

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: introspectionQuery }),
  });

  if (!response.ok) {
    throw new Error(`❌ Failed to fetch schema: ${response.statusText}`);
  }

  const schemaData = await response.json();
  if (schemaData.errors) {
    console.error("❌ Errors in schema response:", schemaData.errors);
    throw new Error("Schema fetch failed.");
  }

  return schemaData.data.__schema.types;
}

function analyzeFields(schema) {
  console.log("🔍 Analyzing fields...");
  const fieldMap = {};

  schema.forEach((type) => {
    if (type.fields) {
      fieldMap[type.name] = type.fields.map((field) => field.name);
    }
  });

  const relevantFields = {};
  Object.entries(fieldMap).forEach(([typeName, fields]) => {
    relevantFields[typeName] = fields.filter((field) =>
      PRIORITY_FIELDS.includes(field)
    );
  });

  return relevantFields;
}

function saveResults(schema, relevantFields) {
  const logsDir = path.resolve(__dirname, "../logs");

  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }

  fs.writeFileSync(
    path.join(logsDir, "raw-schema.json"),
    JSON.stringify(schema, null, 2)
  );
  console.log("✅ Raw schema saved to logs/raw-schema.json");

  fs.writeFileSync(
    path.join(logsDir, "field-analysis.json"),
    JSON.stringify(relevantFields, null, 2)
  );
  console.log("✅ Field analysis saved to logs/field-analysis.json");
}

function generateQuery(relevantFields) {
  const poolsFields = relevantFields.Pool || [];
  const tokensFields = relevantFields.Token || [];

  const query = `
    query {
      pools {
        ${poolsFields.join("\n")}
      }
      tokens {
        ${tokensFields.join("\n")}
      }
    }
  `;

  const logsDir = path.resolve(__dirname, "../logs");
  fs.writeFileSync(path.join(logsDir, "generated-query.graphql"), query);
  console.log("✅ Generated query saved to logs/generated-query.graphql");
}

(async () => {
  try {
    console.log("🚀 Starting schema analysis...");
    const schema = await fetchSchema();
    const relevantFields = analyzeFields(schema);

    saveResults(schema, relevantFields);
    generateQuery(relevantFields);

    console.log("🎉 Schema analysis completed successfully!");
  } catch (error) {
    console.error("❌ Error:", error);
  }
})();
