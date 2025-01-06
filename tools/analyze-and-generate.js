require("dotenv").config();
const fs = require("fs");
const fetch = require("node-fetch");
const readline = require("readline");

// Utility to ask user for input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const askQuestion = (query) =>
  new Promise((resolve) => rl.question(query, resolve));

async function analyzeAndGenerate() {
  try {
    console.log("🚀 Starting schema analyzer and fetcher generator...");

    const apiUrl = process.env.API_URL || (await askQuestion("Enter API URL: "));
    if (!apiUrl) throw new Error("❌ API URL is required!");

    console.log(`📡 Fetching schema from: ${apiUrl}`);
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
                name
              }
              mutationType {
                name
              }
              subscriptionType {
                name
              }
              types {
                name
                fields {
                  name
                }
              }
            }
          }
        `,
      }),
    });

    if (!response.ok) throw new Error(`❌ Failed to fetch schema: ${response.statusText}`);
    const data = await response.json();
    const types = data.data.__schema.types;

    console.log("✅ Schema fetched successfully!");

    // Filter and save schema to file
    const filteredTypes = types.map((type) => ({
      name: type.name,
      fields: type.fields ? type.fields.map((field) => field.name) : [],
    }));
    fs.writeFileSync("./logs/schema-analysis.json", JSON.stringify(filteredTypes, null, 2));
    console.log("✅ Schema saved to: ./logs/schema-analysis.json");

    // Interactive field selection
    console.log("🔍 Available fields:");
    console.table(filteredTypes);

    const selectedFields = (await askQuestion(
      "Enter fields to include (comma-separated): "
    ))
      .split(",")
      .map((field) => field.trim());

    console.log("✅ Selected fields:", selectedFields);

    // Generate fetcher script
    const fetcherTemplate = `
require("dotenv").config();
const fetch = require("node-fetch");

(async () => {
  try {
    const response = await fetch(process.env.API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: \`
          {
            pools {
              ${selectedFields.join("\n              ")}
            }
          }
        \`,
      }),
    });

    if (!response.ok) throw new Error(\`❌ Fetch failed: \${response.statusText}\`);

    const data = await response.json();
    console.log("✅ Fetched Data:", JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("❌ Error:", error);
  }
})();
    `;

    fs.writeFileSync("./data-collection/generated-fetcher.js", fetcherTemplate);
    console.log("✅ Fetcher generated: ./data-collection/generated-fetcher.js");

    rl.close();
  } catch (error) {
    console.error("❌ Error in analyzeAndGenerate:", error);
    rl.close();
  }
}

// Run the script
analyzeAndGenerate();
