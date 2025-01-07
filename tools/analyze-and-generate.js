const fs = require("fs");
const path = require("path");

// Directories for raw data, schemas, and query templates
const RAW_DATA_DIR = path.join(__dirname, "../logs/raw_data");
const SCHEMA_DIR = path.join(__dirname, "../logs/schemas");
const QUERY_TEMPLATE_DIR = path.join(__dirname, "../logs/query_templates");

// Ensure directories exist
fs.mkdirSync(SCHEMA_DIR, { recursive: true });
fs.mkdirSync(QUERY_TEMPLATE_DIR, { recursive: true });

/**
 * Recursively infer schema from JSON data.
 */
function inferSchema(data, parentKey = "") {
  let schema = {};
  if (typeof data === "object" && !Array.isArray(data)) {
    for (let key in data) {
      const fullKey = parentKey ? `${parentKey}.${key}` : key;
      schema[fullKey] = inferSchema(data[key], fullKey);
    }
  } else if (Array.isArray(data)) {
    if (data.length > 0) {
      schema[parentKey + "[]"] = inferSchema(data[0], parentKey + "[]");
    } else {
      schema[parentKey + "[]"] = "EmptyList";
    }
  } else {
    schema[parentKey] = typeof data;
  }
  return schema;
}

/**
 * Generate a GraphQL query template from the schema.
 */
function generateQueryTemplate(schema) {
  let queryFields = Object.keys(schema)
    .map((key) => `  ${key.split(".").pop()}`)
    .join("\n");
  return `query {\n${queryFields}\n}`;
}

/**
 * Process raw data files to infer schema and generate query templates.
 */
function processRawDataFiles() {
  const rawFiles = fs.readdirSync(RAW_DATA_DIR).filter((file) => file.endsWith("-raw.json"));

  rawFiles.forEach((file) => {
    const dexName = file.replace("-raw.json", "");
    const rawDataPath = path.join(RAW_DATA_DIR, file);

    console.log(`🔍 Processing raw data for: ${dexName}`);
    let rawData;
    try {
      rawData = JSON.parse(fs.readFileSync(rawDataPath, "utf-8"));
    } catch (err) {
      console.error(`❌ Error reading or parsing ${file}: ${err.message}`);
      return;
    }

    // Infer schema from raw data
    const schema = inferSchema(rawData);

    // Save schema to file
    const schemaPath = path.join(SCHEMA_DIR, `${dexName}-schema.json`);
    fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
    console.log(`✅ Schema saved for ${dexName}: ${schemaPath}`);

    // Generate query template
    const queryTemplate = generateQueryTemplate(schema);
    const queryTemplatePath = path.join(QUERY_TEMPLATE_DIR, `${dexName}-query.graphql`);
    fs.writeFileSync(queryTemplatePath, queryTemplate);
    console.log(`✅ Query template saved for ${dexName}: ${queryTemplatePath}`);
  });
}

// Run the processing function
processRawDataFiles();
