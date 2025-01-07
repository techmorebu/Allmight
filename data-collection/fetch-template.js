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

console.log(`🚀 Fetching data for ${DEX_NAME} using API: ${API_URL}`);

async function fetchData() {
    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: `{ pools { id txCount volumeUSD } }` }),
        });

        if (!response.ok) {
            throw new Error(`❌ API response error: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.errors) {
            console.error(`❌ API Errors:`, data.errors);
            return [];
        }

        return data.data.pools || [];
    } catch (error) {
        console.error(`❌ Error fetching data for ${DEX_NAME}:`, error);
        return [];
    }
}

async function main() {
    const pools = await fetchData();

    if (pools.length === 0) {
        console.warn(`⚠️ No data fetched for ${DEX_NAME}.`);
        return;
    }

    const logFilePath = path.join("logs/dex-logs", `${DEX_NAME}-raw.json`);
    fs.writeFileSync(logFilePath, JSON.stringify(pools, null, 2));
    console.log(`✅ Raw data saved for ${DEX_NAME}: ${logFilePath}`);
}

main();
