require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DEX_NAME = process.env.DEX_NAME || "unknown-dex";
const API_URL = process.env.API_URL || "";

async function fetchData() {
    try {
        console.log(`📡 Fetching raw data for ${DEX_NAME}...`);
        const response = await axios.post(API_URL, {
            query: `{
                pools(first: 10) {
                    id
                    volumeUSD
                    liquidity
                }
            }`,
        });

        const rawData = response.data;
        const logsDir = path.resolve(__dirname, "../logs/raw_data");

        // Ensure logs/raw_data directory exists
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        // Save raw data to file
        const filePath = path.join(logsDir, `${DEX_NAME}-raw.json`);
        fs.writeFileSync(filePath, JSON.stringify(rawData, null, 2));
        console.log(`✅ Raw data saved to ${filePath}`);
    } catch (error) {
        console.error(`❌ Error fetching data for ${DEX_NAME}:`, error.message);
    }
}

fetchData();
