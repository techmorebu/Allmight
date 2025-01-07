require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

async function fetchSchema(apiUrl) {
    try {
        console.log("🚀 Fetching schema...");
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query: `
                {
                    __schema {
                        queryType {
                            fields {
                                name
                                type {
                                    name
                                    kind
                                    ofType {
                                        name
                                    }
                                }
                            }
                        }
                    }
                }
                `,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch schema: ${response.statusText}`);
        }

        const data = await response.json();
        console.log("✅ Schema fetched successfully.");
        return data.data.__schema.queryType.fields;
    } catch (error) {
        console.error("❌ Error fetching schema:", error);
        return [];
    }
}

function analyzeSchema(fields) {
    console.log("🔍 Analyzing schema...");
    const importantFields = fields.filter((field) =>
        ["pools", "liquidity", "volumeUSD", "txCount"].includes(field.name)
    );
    console.log(`✅ Found ${importantFields.length} relevant fields.`);
    return importantFields;
}

function generateFetcherTemplate(dexName, apiUrl, fields) {
    const outputPath = path.resolve(
        __dirname,
        `../data-collection/fetch-${dexName.toLowerCase()}-data.js`
    );

    const fetcherTemplate = `
require("dotenv").config();
const fetch = require("node-fetch");

(async function fetchData() {
    try {
        console.log("🚀 Fetching data for ${dexName}...");
        const response = await fetch("${apiUrl}", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query: \`
                    query {
                        ${fields
                            .map(
                                (field) =>
                                    `${field.name} { id volumeUSD txCount liquidity token0 { symbol } token1 { symbol } }`
                            )
                            .join("\n")}
                    }
                \`,
            }),
        });

        const data = await response.json();
        if (data.errors) {
            console.error("❌ Errors in API response:", data.errors);
        } else {
            console.log("✅ Data fetched successfully:", data.data);
        }
    } catch (error) {
        console.error("❌ Error fetching data for ${dexName}:", error);
    }
})();
`;

    fs.writeFileSync(outputPath, fetcherTemplate);
    console.log(`✅ Fetcher template for ${dexName} saved to: ${outputPath}`);
}

(async function main() {
    const apiUrl = process.env.API_URL;

    if (!apiUrl) {
        console.error("❌ Error: API_URL not defined in .env");
        return;
    }

    const dexName = process.env.DEX || "unknown-dex";
    console.log(`🔄 Processing DEX: ${dexName}`);

    const fields = await fetchSchema(apiUrl);

    if (fields.length === 0) {
        console.error("⚠️ No schema fields found. Exiting.");
        return;
    }

    const relevantFields = analyzeSchema(fields);

    if (relevantFields.length > 0) {
        generateFetcherTemplate(dexName, apiUrl, relevantFields);
    }
})();
