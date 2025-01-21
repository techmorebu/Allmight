const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const consolidatedFile = path.join(outputDir, "consolidated-fields.json");
const crossReferenceReport = path.join(outputDir, "cross-reference-report.json");
const requiredFields = ["price", "volume", "liquidity", "fees", "volatility", "RSI", "movingAverage", "correlation", "zScore", "spread"];

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Cross-reference mapped fields with enhanced logic
function crossReferenceFields(mappedData) {
  const report = mappedData.map((api) => {
    const availableFields = api.fields;

    // Exact matches
    const exactMatches = requiredFields.filter((field) =>
      availableFields.some((available) => available.name === field)
    );

    // Fuzzy matches
    const fuzzyMatches = fuzzyMatchFields(requiredFields, availableFields);

    // Metadata-based matches
    const metadataMatches = requiredFields.reduce((acc, field) => {
      acc[field] = findMetadataRelatedFields(availableFields, field);
      return acc;
    }, {});

    // Missing fields
    const missingFields = requiredFields.filter((field) => !exactMatches.includes(field));

    // Consolidated report for this API
    return {
      apiName: api.apiName,
      exactMatches,
      fuzzyMatches,
      metadataMatches,
      missingFields,
      completeness: ((requiredFields.length - missingFields.length) / requiredFields.length) * 100,
    };
  });

  // Save enhanced cross-reference report
  console.log("Enhanced Cross-Reference Report:", JSON.stringify(report, null, 2));
  fs.writeFileSync(crossReferenceReport, JSON.stringify(report, null, 2));
}

// Utility: Calculate string similarity
function calculateStringSimilarity(a, b) {
  const common = a.split(" ").filter((word) => b.includes(word)).length;
  return (2 * common) / (a.split(" ").length + b.split(" ").length);
}

// Utility: Fuzzy match fields
function fuzzyMatchFields(requiredFields, availableFields) {
  const threshold = 0.7; // Similarity threshold
  const similarFields = {};

  requiredFields.forEach((requiredField) => {
    similarFields[requiredField] = availableFields.filter((field) => {
      const similarity = calculateStringSimilarity(requiredField, field.name);
      return similarity >= threshold;
    });
  });

  return similarFields;
}

// Utility: Metadata-based matching
function findMetadataRelatedFields(fields, requiredField) {
  return fields.filter((field) =>
    field.description && field.description.toLowerCase().includes(requiredField.toLowerCase())
  );
}

// Recursive function to map fields, including trend and statistical placeholders
function recursiveMapFields(fields, parent = null, depth = 0) {
  const mappedFields = [];
  const dynamicFields = ["movingAverage", "RSI", "volatility", "priceMomentum", "spread", "correlation", "zScore"];

  fields.forEach((field) => {
    const mappedField = {
      name: field.name,
      type: field.type.name || field.type.ofType?.name || "Unknown",
      kind: field.type.kind,
      parent,
      depth,
      description: field.description || "N/A",
      args: field.args.map((arg) => ({
        name: arg.name,
        type: arg.type.name || arg.type.ofType?.name || "Unknown",
        description: arg.description || "N/A",
      })),
    };

    dynamicFields.forEach((dynamicField) => {
      mappedField[dynamicField] = null; // Placeholder for trend and statistical data
    });

    mappedFields.push(mappedField);

    if (field.type.kind === "OBJECT" && field.type.fields) {
      mappedFields.push(...recursiveMapFields(field.type.fields, field.name, depth + 1));
    }
  });

  return mappedFields;
}

// Fetch schema and fields recursively for GraphQL
async function fetchGraphQLSchema(apiUrl) {
  const introspectionQuery = `{
    __schema {
      types {
        name
        kind
        fields {
          name
          description
          args {
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
      body: JSON.stringify({ query: introspectionQuery }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch schema: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data.__schema.types;
  } catch (error) {
    console.error(`Error fetching GraphQL schema: ${error.message}`);
    return null;
  }
}

// Fetch and process data for each API
async function runMapper() {
  const consolidatedData = [];

  for (const [apiName, apiUrl] of Object.entries(apis)) {
    console.log(`Processing API: ${apiName}`);

    const apiType = determineApiType(apiUrl);
    if (apiType !== "GraphQL") {
      console.log(`Skipping ${apiName}: Unsupported API type.`);
      continue;
    }

    const schema = await fetchGraphQLSchema(apiUrl);
    if (!schema) {
      console.error(`Skipping ${apiName} due to schema fetch error.`);
      continue;
    }

    const relevantTypes = schema.filter((type) => type.kind === "OBJECT" && !type.name.startsWith("__"));
    const mappedData = [];

    relevantTypes.forEach((type) => {
      if (type.fields) {
        mappedData.push(...recursiveMapFields(type.fields, type.name));
      }
    });

    consolidatedData.push({
      apiName,
      timestamp: new Date().toISOString(),
      fields: mappedData,
    });

    console.log(`Mapped fields for ${apiName} processed.`);
  }

  // Save consolidated output
  fs.writeFileSync(consolidatedFile, JSON.stringify(consolidatedData, null, 2));
  console.log(`Consolidated output saved to ${consolidatedFile}`);

  // Cross-reference fields with enhanced logic
  crossReferenceFields(consolidatedData);
}

// Run the mapper
runMapper();
