require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

// Fetch and analyze schema
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
                            types {
                                name
                                fields {
                                    name
                                    type {
                                        kind
                                        name
                                        ofType {
                                            kind
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
            throw new Error(`❌ Failed to fetch schema: ${response.statusText}`);
        }

        const data = await response.json();
        return data.data.__schema.types;
    } catch (error) {
        console.error("❌ Error fetching schema:", error);
        throw error;
    }
}

// Analyze fields and prioritize
function analyzeFields(schemaTypes) {
    console.log("🔍 Analyzing fields...");
    const priorityFields = [
        "id", "txCount", "volumeUSD", "liquidity", "token0", "token1",
        "token0Price", "token1Price", "feesUSD", "tick", "sqrtPrice"
    ];

    const fieldAnalysis = schemaTypes
        .flatMap((type) => type.fields || [])
        .filter((field) => priorityFields.includes(field.name))
        .map((field) => ({
            name: field.name,
            type: field.type.kind === "NON_NULL" ? field.type.ofType.name : field.type.name,
        }));

    return fieldAnalysis;
}

// Generate GraphQL query
function generateQuery(fields) {
    console.log("🛠 Generating GraphQL query...");
    const poolFields = fields.map((field) => `    ${field.name}`).join("\n");
    return `
        query {
            pools {
${poolFields}
            }
        }
    `;
}

// Update fetcher script
function updateFetcherScript(fetcherPath, generatedQuery) {
    try {
        console.log("🔄 Updating fetcher script...");

        const fetcherContent = fs.readFileSync(fetcherPath, "utf-8");
        const updatedContent = fetcherContent.replace(
            /query\s+\{([\s\S]*?)\}/g,
            generatedQuery.trim()
        );

        fs.writeFileSync(fetcherPath, updatedContent);
        console.log(`✅ Fetcher script updated: ${fetcherPath}`);
    } catch (error) {
        console.error("❌ Error updating fetcher script:", error);
        throw error;
    }
}

// Main execution
(async () => {
    try {
        const apiUrl = process.env.API_URL;
        if (!apiUrl) {
            throw new Error("❌ API_URL is not defined in the .env file");
        }

        const schemaTypes = await fetchSchema(apiUrl);
        fs.writeFileSync("./logs/raw-schema.json", JSON.stringify(schemaTypes, null, 2));
        console.log("✅ Raw schema saved to logs/raw-schema.json");

        const fields = analyzeFields(schemaTypes);
        fs.writeFileSync("./logs/field-analysis.json", JSON.stringify(fields, null, 2));
        console.log("✅ Field analysis saved to logs/field-analysis.json");

        const generatedQuery = generateQuery(fields);
        fs.writeFileSync("./logs/generated-query.graphql", generatedQuery);
        console.log("✅ Generated query saved to logs/generated-query.graphql");

        // Path to your fetcher script
        const fetcherPath = path.join(__dirname, "../data-collection/fetch-quickswap-data.js");
        updateFetcherScript(fetcherPath, generatedQuery);

        console.log("🎉 Schema analysis and fetcher update completed successfully!");
    } catch (error) {
        console.error("❌ Error in analyze-and-generate.js:", error);
    }
})();
