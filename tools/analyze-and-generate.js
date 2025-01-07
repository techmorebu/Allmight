require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const API_URL = process.env.API_URL;
const DEX_NAME = process.env.DEX_NAME || "unknown-dex";

if (!API_URL) {
    console.error(`❌ API_URL is not defined for ${DEX_NAME}`);
    process.exit(1);
}

console.log(`🚀 Starting schema analysis for ${DEX_NAME}...`);
console.log(`📡 Using API URL: ${API_URL}`);


async function fetchSchema() {
    const apiUrl = process.env.API_URL;
    console.log(`🚀 Fetching schema from: ${apiUrl}`);

    // Simulated schema fetching logic
    const schema = {}; // Fetch actual schema
    return schema;
}

function analyzeFields(schema) {
    console.log("🔍 Analyzing schema fields...");
    // Logic to analyze fields
    return ["id", "price0", "price1", "liquidityNet"]; // Example
}

function generateQuery(fields) {
    console.log("🛠 Generating query...");
    return `
        query {
            pools {
                ${fields.join("\n")}
            }
        }
    `;
}

async function main() {
    const apiName = process.env.DEX_NAME || "unknown-dex";
    const logDir = `./logs/${apiName}`;
    fs.mkdirSync(logDir, { recursive: true });

    console.log(`🚀 Fetching schema for ${apiName}...`);
    const schema = await fetchSchema();

    const relevantFields = analyzeFields(schema);
    const query = generateQuery(relevantFields);

    fs.writeFileSync(path.join(logDir, "schema.json"), JSON.stringify(schema, null, 2));
    fs.writeFileSync(path.join(logDir, "generated-query.graphql"), query);

    console.log(`🎉 Analyze-and-generate process for ${apiName} completed.`);
}

main();
