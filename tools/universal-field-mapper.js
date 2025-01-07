const fetch = require("node-fetch");
const fs = require("fs");

// Function to fetch and introspect GraphQL schema
async function fetchGraphQLSchema(endpoint, headers = {}) {
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
      console.error("❌ GraphQL Schema Fetch Error:", rawSchema.errors);
      return;
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

    console.log(chart);

    // Save to file
    fs.writeFileSync("graphql-fields.txt", chart);
    console.log("✅ GraphQL schema saved to graphql-fields.txt");
  } catch (error) {
    console.error("❌ Error fetching GraphQL schema:", error);
  }
}

// Function to fetch and map REST API fields
async function fetchRESTData(endpoint, method = "GET", headers = {}, body = null) {
  try {
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : null,
    });
    const data = await response.json();

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

    const fields = mapFields(data);
    const chart = fields.map(field => `  - ${field}`).join("\n");

    console.log(chart);

    // Save to file
    fs.writeFileSync("rest-fields.txt", chart);
    console.log("✅ REST API fields saved to rest-fields.txt");
  } catch (error) {
    console.error("❌ Error fetching REST API data:", error);
  }
}

// Universal query function
async function queryAPI(endpoint, type, options = {}) {
  const { method = "GET", headers = {}, body = null } = options;

  if (type === "graphql") {
    await fetchGraphQLSchema(endpoint, headers);
  } else if (type === "rest") {
    await fetchRESTData(endpoint, method, headers, body);
  } else {
    console.error("❌ Unknown API type. Please specify 'graphql' or 'rest'.");
  }
}

// Usage example
// queryAPI("https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3", "graphql");
// queryAPI("https://api.curve.fi/api/getPools/ethereum", "rest");
