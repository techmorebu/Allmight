// universal-field-mapper.js
// Introspects DEX APIs (GraphQL + REST), extracts field metadata,
// and writes JSON/CSV/HTML reports with robust logging.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const cron = require("node-cron");

const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 };

function log(level, message, meta = {}) {
  if (!(level in LEVEL_RANK)) level = "info";
  if (LEVEL_RANK[level] < LEVEL_RANK[LOG_LEVEL]) return;

  const ts = new Date().toISOString();
  const base = `[FIELD-MAPPER][${level.toUpperCase()}][${ts}] ${message}`;
  if (Object.keys(meta).length > 0) {
    console.log(base, JSON.stringify(meta));
  } else {
    console.log(base);
  }
}

const outputDir = path.resolve(__dirname, "../../outputs");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  log("info", "Created outputs directory", { outputDir });
}

// Map of API names to URLs. You can add/remove as needed.
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

// Utility: detect if an API is GraphQL (TheGraph-style) vs REST.
// You can refine this later (e.g., explicit env flags).
function isGraphqlEndpoint(url) {
  if (!url) return false;
  return url.includes("thegraph") || url.endsWith("/graphql");
}

// Simple network helper with timeout and structured errors.
async function safeFetch(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Extract GraphQL schema via introspection.
async function fetchGraphqlSchema(apiName, apiUrl) {
  const query = `
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

  log("info", "Fetching GraphQL schema", { apiName, apiUrl });

  try {
    const data = await safeFetch(
      apiUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      },
      15000
    );

    if (!data || !data.data || !data.data.__schema || !Array.isArray(data.data.__schema.types)) {
      log("warn", "Unexpected GraphQL schema response structure", { apiName });
      return [];
    }

    return data.data.__schema.types;
  } catch (err) {
    log("error", "Failed to fetch GraphQL schema", {
      apiName,
      apiUrl,
      error: err.message,
    });
    return [];
  }
}

// Extract REST schema by sampling JSON and inferring fields.
async function fetchRestSchema(apiName, apiUrl) {
  log("info", "Fetching REST sample for schema inference", { apiName, apiUrl });

  try {
    const data = await safeFetch(apiUrl, {}, 15000);

    if (!data) {
      log("warn", "Empty REST response; cannot infer schema", { apiName });
      return [];
    }

    // Heuristic: inspect first array element or object
    let sample = data;
    if (Array.isArray(data)) {
      sample = data[0] || {};
    }

    if (typeof sample !== "object" || sample === null) {
      log("warn", "REST sample is not an object; cannot infer fields", { apiName });
      return [];
    }

    return processRestApiSchema(sample, apiName);
  } catch (err) {
    log("error", "Failed to fetch REST schema sample", {
      apiName,
      apiUrl,
      error: err.message,
    });
    return [];
  }
}

// Builds a flat list of field descriptors for GraphQL schemas.
function processGraphqlSchema(types, apiName) {
  const fields = [];
  if (!Array.isArray(types)) {
    log("warn", "processGraphqlSchema called with non-array types", { apiName });
    return fields;
  }

  for (const type of types) {
    if (!type || !type.fields || !Array.isArray(type.fields)) continue;

    for (const field of type.fields) {
      let typeName = field.type?.name || field.type?.ofType?.name || "Unknown";
      fields.push({
        api: apiName,
        parent: type.name || "UnknownType",
        name: field.name || "UnknownField",
        type: typeName,
      });
    }
  }

  return fields;
}

// Builds a flat list of field descriptors for REST JSON object.
function processRestApiSchema(sampleObject, apiName, parentKey = "") {
  const fields = [];

  for (const [key, value] of Object.entries(sampleObject)) {
    const fullKey = parentKey ? `${parentKey}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      fields.push(
        ...processRestApiSchema(value, apiName, fullKey)
      );
    } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      fields.push(
        ...processRestApiSchema(value[0], apiName, `${fullKey}[]`)
      );
    } else {
      fields.push({
        api: apiName,
        parent: parentKey || "root",
        name: fullKey,
        type: Array.isArray(value) ? "Array" : typeof value,
      });
    }
  }

  return fields;
}

// Wrapper that delegates to GraphQL or REST behavior.
async function fetchApiSchema(apiName, apiUrl) {
  if (!apiUrl) {
    log("warn", "No API URL defined in env; skipping", { apiName });
    return [];
  }

  try {
    if (isGraphqlEndpoint(apiUrl)) {
      const types = await fetchGraphqlSchema(apiName, apiUrl);
      return processGraphqlSchema(types, apiName);
    } else {
      return await fetchRestSchema(apiName, apiUrl);
    }
  } catch (err) {
    log("error", "Unhandled error while fetching API schema", {
      apiName,
      apiUrl,
      error: err.message,
    });
    return [];
  }
}

function saveJsonOutput(fileName, fields, apiName) {
  const filePath = path.join(outputDir, fileName);
  const payload = {
    metadata: {
      apiName,
      timestamp: new Date().toISOString(),
      totalFields: fields.length,
    },
    fields,
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    log("info", "JSON output saved", { filePath, apiName, totalFields: fields.length });
  } catch (err) {
    log("error", "Failed to write JSON output", { filePath, error: err.message });
  }
}

function saveCsvOutput(fileName, fields, apiName) {
  const filePath = path.join(outputDir, fileName);
  if (!Array.isArray(fields) || fields.length === 0) {
    log("warn", "No fields to write to CSV", { apiName, filePath });
    return;
  }

  const headers = Object.keys(fields[0]);
  const lines = [
    headers.join(","),
    ...fields.map((field) => headers.map((h) => JSON.stringify(field[h] ?? "")).join(",")),
  ];
  const csvContent = lines.join("\n");

  try {
    fs.writeFileSync(filePath, csvContent, "utf8");
    log("info", "CSV output saved", { filePath, apiName, totalFields: fields.length });
  } catch (err) {
    log("error", "Failed to write CSV output", { filePath, error: err.message });
  }
}

function saveHtmlOutput(fileName, fields, apiName) {
  const filePath = path.join(outputDir, fileName);
  const rows = fields
    .map(
      (f) =>
        `<tr><td>${f.api}</td><td>${f.parent}</td><td>${f.name}</td><td>${f.type}</td></tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Field Mapping - ${apiName}</title>
  <style>
    body { font-family: sans-serif; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px; font-size: 12px; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>Field Mapping - ${apiName}</h1>
  <p>Generated at ${new Date().toISOString()}</p>
  <table>
    <thead>
      <tr>
        <th>API</th>
        <th>Parent</th>
        <th>Name</th>
        <th>Type</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;

  try {
    fs.writeFileSync(filePath, html, "utf8");
    log("info", "HTML output saved", { filePath, apiName, totalFields: fields.length });
  } catch (err) {
    log("error", "Failed to write HTML output", { filePath, error: err.message });
  }
}

async function runMapper() {
  log("info", "Starting field mapper run");

  for (const [apiName, apiUrl] of Object.entries(apis)) {
    const dateStamp = new Date().toISOString().split("T")[0];

    try {
      const fields = await fetchApiSchema(apiName, apiUrl);

      log("info", "Schema extraction completed", {
        apiName,
        apiUrl,
        totalFields: fields.length,
      });

      const jsonFileName = `${apiName}-fields-${dateStamp}.json`;
      const csvFileName = `${apiName}-fields-${dateStamp}.csv`;
      const htmlFileName = `${apiName}-fields-${dateStamp}.html`;

      saveJsonOutput(jsonFileName, fields, apiName);
      saveCsvOutput(csvFileName, fields, apiName);
      saveHtmlOutput(htmlFileName, fields, apiName);
    } catch (err) {
      log("error", "Unhandled error while processing API", {
        apiName,
        apiUrl,
        error: err.message,
        stack: err.stack,
      });
    }
  }

  log("info", "Field mapper run completed");
}

// CLI entry + cron wiring
if (require.main === module) {
  const mode = process.argv[2] || "once";

  if (mode === "cron") {
    const cronExpr = process.env.FIELD_MAPPER_CRON || "0 0 * * *"; // daily at midnight
    log("info", "Starting field mapper cron job", { cronExpr });

    cron.schedule(cronExpr, () => {
      runMapper().catch((err) => {
        log("error", "Unhandled error in cron run", {
          error: err.message,
          stack: err.stack,
        });
      });
    });
  } else {
    runMapper().catch((err) => {
      log("error", "Unhandled error in one-shot run", {
        error: err.message,
        stack: err.stack,
      });
      process.exitCode = 1;
    });
  }
}

module.exports = {
  runMapper,
};
