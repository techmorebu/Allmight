require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const API_URL = process.env.API_URL;
const DEX_NAME = process.env.DEX_NAME;
const LOG_DIR = path.join(__dirname, "../logs/dex-logs");

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

async function fetchData() {
    try {
        console.log(`🚀 Fetching data from ${DEX_NAME}...`);
        const response = await axios.post(API_URL, {
            query: "{ pools { id, liquidity, volumeUSD, token0 { symbol }, token1 { symbol } } }"
        });

        const rawData = response.data;
        const logFile = path.join(LOG_DIR, `${DEX_NAME}-raw.json`);

        // Save raw data
        fs.writeFileSync(logFile, JSON.stringify(rawData, null, 2));
        console.log(`✅ Raw data saved to ${logFile}`);
    } catch (error) {
        console.error(`❌ Error fetching data for ${DEX_NAME}:`, error.message);
    }
}

fetchData();
