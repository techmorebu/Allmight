const fetch = require("node-fetch");
const fs = require("fs");
require("dotenv").config(); // Load .env variables

// Function to handle pagination for REST APIs
async function fetchAllPages(endpoint, headers, handle, pageParam = "page", startPage = 1) {
  let currentPage = startPage;
  let allData = [];

  while (true) {
    const url = `${endpoint}?${pageParam}=${currentPage}`;
    console.log(`🔍 Fetching page ${currentPage} for ${handle}: ${url}`);
    try {
      const response = await fetch(url, {
        headers: { "Content-Type": "application/json", ...headers },
      });
      const data = await response.json();

      if (!data || Object.keys(data).length === 0) {
        console.log(`✅ Completed pagination for ${handle}.`);
        break;
      }

      allData.push(data);
      currentPage++;
    } catch (error) {
      console.error(`❌ Error fetching page ${currentPage} for ${handle}:`, error);
      break;
    }
  }

  return allData;
}

// Function to fetch and introspect GraphQL schema
async function fetchGraphQLSchema(endpoint, handle, headers = {}) {
  const introspectionQuery = `
  {
    __schema {
      types {
        name
        kind
        description
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
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ query: introspectionQuery }),
    });

    const rawSchema = await response.json();

    if (rawSchema.errors) {
      throw new Error(`GraphQL Schema Fetch Error: ${JSON.stringify(rawSchema.errors)}`);
    }

    const schema = rawSchema.data.__schema.types;

    // Format schema into readable chart
    const chart = schema.map(type => {
      const fields = type.fields
        ? type.fields
            .map(field => `  - ${field.name} (${field.type.kind})${field.description ? `: ${field.description}` : ""}`)
            .join("\n")
        : "  - No fields";
      return `Type: ${type.name} (${type.kind})\n${fields}`;
    }).join("\n\n");

    console.log(`✅ GraphQL schema retrieved for ${handle}`);

    // Save to file
    fs.writeFileSync(`${handle}_graphql-fields.txt`, chart);
    console.log(`✅ GraphQL schema saved to ${handle}_graphql-fields.txt`);
  } catch (error) {
    console.error(`❌ Error fetching GraphQL schema for ${handle}:`, error);
    throw error;
  }
}

// Function to fetch and map REST API fields
async function fetchRESTData(endpoint, handle, headers = {}) {
  try {
    // Handle pagination
    const allData = await fetchAllPages(endpoint, headers, handle);
    const combinedData = Object.assign({}, ...allData);

    const mapFields = (obj, prefix = "") =>
      Object.keys(obj).reduce((res, key) => {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof obj[key] === "object" && obj[key] !== null) {
          res.push(fullKey);
          res.push(...mapFields(obj[key], fullKey));
        } else {
          res.push(fullKey);
        }
        return res;
      }, []);

    const fields = mapFields(combinedData);
    const chart = fields.map(field => `  - ${field}`).join("\n");

    console.log(`✅ REST API fields retrieved for ${handle}`);

    // Save to file
    fs.writeFileSync(`${handle}_rest-fields.txt`, chart);
    console.log(`✅ REST API fields saved to ${handle}_rest-fields.txt`);
  } catch (error) {
    console.error(`❌ Error fetching REST API data for ${handle}:`, error);
    throw error;
  }
}

// Universal query function
async function queryAPIFromEnv(outputDir = "./") {
  const envVars = Object.entries(process.env);
  const dexApis = envVars.filter(([key, value]) => key.endsWith("_DEX_API"));

  if (dexApis.length === 0) {
    console.error("❌ No DEX APIs found in .env file.");
    return;
  }

  let report = "API Query Report:\n\n";

  for (const [key, endpoint] of dexApis) {
    const handle = key.replace("_DEX_API", "").toLowerCase(); // Generate handle name
    console.log(`🔍 Querying API for ${handle} (${endpoint})...`);

    try {
      if (endpoint.includes("graphql") || endpoint.includes("thegraph")) {
        await fetchGraphQLSchema(endpoint, handle);
      } else {
        await fetchRESTData(endpoint, handle);
      }

      report += `✅ Success: ${handle} (${endpoint})\n`;
    } catch (error) {
      report += `❌ Failed: ${handle} (${endpoint}) - ${error.message}\n`;
    }
  }

  // Save report
  const reportPath = `${outputDir}report.txt`;
  fs.writeFileSync(reportPath, report);
  console.log(`✅ Report saved to ${reportPath}`);
}

// Execute the query
queryAPIFromEnv("./outputs/");
