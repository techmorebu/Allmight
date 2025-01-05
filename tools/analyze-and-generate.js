require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

async function fetchSchema(apiUrl, typeName) {
  console.log(`🚀 Fetching schema for type: ${typeName} from: ${apiUrl}`);

  const introspectionQuery = {
    query: `
      {
        __type(name: "${typeName}") {
          fields {
            name
            type {
              name
              kind
              ofType {
                name
                kind
                ofType {
                  name
                  kind
                }
              }
            }
            description
          }
        }
      }
    `
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(introspectionQuery)
  });

  const data = await response.json();
  if (data.errors) {
    console.error("❌ Error fetching schema:", data.errors);
    throw new Error("Schema fetching failed.");
  }

  const fields = data.data.__type.fields;
  return fields.map(field => ({
    name: field.name,
    type: field.type,
    description: field.description || "No description available"
  }));
}

function resolveType(type) {
  if (!type) return "string"; // Default to string if type is missing

  if (type.name) return type.name; // Direct type name
  if (type.ofType) return resolveType(type.ofType); // Recursively resolve nested types

  return "string"; // Fallback
}

function generateSchema(fields) {
  const schema = {
    type: "object",
    properties: {},
    required: []
  };

  fields.forEach(field => {
    const resolvedType = resolveType(field.type);

    // Map GraphQL types to JSON Schema types
    const jsonType = resolvedType === "Int" ? "integer" :
                     resolvedType === "Float" ? "number" :
                     resolvedType === "Boolean" ? "boolean" : "string";

    schema.properties[field.name] = {
      type: jsonType,
      description: field.description || "No description available"
    };

    // Add to required fields
    schema.required.push(field.name);
  });

  return schema;
}

async function main() {
  try {
    const apiUrl = process.env.NEW_DEX_API_URL;
    const typeName = process.env.NEW_DEX_TYPE || "Pool";

    // Fetch schema fields
    const fields = await fetchSchema(apiUrl, typeName);

    // Generate schema
    const schema = generateSchema(fields);

    // Save schema
    const schemaPath = path.resolve(__dirname, "../logs/generated-schema.json");
    fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
    console.log(`✅ Schema saved to: ${schemaPath}`);
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

main();
