require("dotenv").config();
const fs = require("fs");
const path = require("path");

// Ensure required environment variables are present
if (!process.env.API_URL || !process.env.DEX_NAME) {
    console.error("❌ Error: Missing API_URL or DEX_NAME in .env file.");
    process.exit(1);
}

console.log(`🔍 Starting schema analysis for DEX: ${process.env.DEX_NAME}`);
console.log(`📡 Using API URL: ${process.env.API_URL}`);

// Mocked schema fetcher (replace with actual implementation)
function fetchSchema(apiUrl) {
    console.log(`🚀 Fetching schema from: ${apiUrl}`);
    // Replace with actual schema fetching logic
    return { mockField1: "String", mockField2: "Int" }; // Example
}

// Mocked query generator
function generateQuery(schema) {
    console.log("🛠 Generating query template...");
    return `
query {
    ${Object.keys(schema).map(field => `${field}`).join("\n    ")}
}`;
}

// Main process
(async () => {
    const schema = fetchSchema(process.env.API_URL);
    const schemaPath = path.join(__dirname, `../logs/schemas/${process.env.DEX_NAME}-schema.json`);
    const queryTemplatePath = path.join(__dirname, `../logs/query_templates/${process.env.DEX_NAME}-query.graphql`);

    // Save schema
    fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
    console.log(`✅ Schema saved to: ${schemaPath}`);

    // Save query template
    const queryTemplate = generateQuery(schema);
    fs.writeFileSync(queryTemplatePath, queryTemplate);
    console.log(`✅ Query template saved to: ${queryTemplatePath}`);
})();
