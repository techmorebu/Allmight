require("dotenv").config();
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

// List of DEX APIs from .env
const DEX_APIS = [
    { name: "Quickswap", url: process.env.QUICKSWAP_API },
    { name: "Uniswap", url: process.env.UNISWAP_API },
    { name: "Sushiswap", url: process.env.SUSHISWAP_API },
    { name: "Balancer_Polygon", url: process.env.BALANCER_POLYGON_API },
    { name: "Balancer_Optimism", url: process.env.BALANCER_OPTIMISM_API },
    { name: "Balancer_Arbitrum", url: process.env.BALANCER_ARBITRUM_API },
    { name: "Balancer_Avalanche", url: process.env.BALANCER_AVALANCHE_API },
    { name: "Balancer_Ethereum", url: process.env.BALANCER_ETHEREUM_API },
    { name: "Curve_Avalanche", url: process.env.CURVE_AVALANCHE_API },
    { name: "Curve_Ethereum", url: process.env.CURVE_ETHEREUM_API },
];

// Ensure the logs directory exists
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log("✅ Created logs directory.");
}

async function runCommand(command, dexName) {
    return new Promise((resolve, reject) => {
        const logFile = path.join(logsDir, `${dexName}-log.txt`);
        const logStream = fs.createWriteStream(logFile, { flags: "a" });
        const process = exec(command);

        process.stdout.on("data", (data) => logStream.write(data));
        process.stderr.on("data", (data) => logStream.write(data));

        process.on("close", (code) => {
            logStream.end();
            if (code !== 0) {
                return reject(new Error(`Command failed with code ${code}`));
            }
            resolve();
        });
    });
}

async function processDEX(dex) {
    try {
        console.log(`🚀 Processing DEX: ${dex.name}...`);
        
        const envPath = "./.env";
        const currentEnv = fs.readFileSync(envPath, "utf8");
        const updatedEnv = currentEnv
            .replace(/API_URL=.*/, `API_URL=${dex.url}`)
            .replace(/DEX_NAME=.*/, `DEX_NAME=${dex.name}`);
        fs.writeFileSync(envPath, updatedEnv);

        console.log(`📊 Running schema analysis for ${dex.name}...`);
        await runCommand("node tools/analyze-and-generate.js", dex.name);

        console.log(`📡 Fetching and filtering data for ${dex.name}...`);
        await runCommand("node data-collection/fetch-template.js", dex.name);

        console.log(`✅ ${dex.name} processing completed successfully!`);
    } catch (error) {
        console.error(`❌ Error processing ${dex.name}:`, error);
    }
}

async function masterAutomation() {
    for (const dex of DEX_APIS) {
        if (!dex.url) {
            console.warn(`⚠️ Skipping ${dex.name}: API URL not defined.`);
            continue;
        }
        await processDEX(dex);
    }
    console.log("🎉 All DEXs processed successfully!");
}

masterAutomation();
