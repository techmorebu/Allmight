require("dotenv").config();
const fs = require("fs");
const path = require("path");

const API_URL = process.env.API_URL;
const DEX_NAME = process.env.DEX_NAME;
const LOG_DIR = path.join(__dirname, "../logs/dex-logs");

async function analyzeSchema() {
    try {
        console.log(`🚀 Analyzing schema for ${DEX_NAME}...`);
        // Simulate schema analysis logic
        const query = `query { pools { id, token0 { symbol }, token1 { symbol }, liquidity, volumeUSD } }`;

        const logFile = path.join(LOG_DIR, `${DEX_NAME}-query.graphql`);
        fs.writeFileSync(logFile, query);

        console.log(`✅ Query generated for ${DEX_NAME} saved to ${logFile}`);
    } catch (error) {
        console.error(`❌ Error analyzing schema for ${DEX_NAME}:`, error.message);
    }
}

analyzeSchema();
