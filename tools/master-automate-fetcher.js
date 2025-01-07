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

async function runCommand(command, logFilePath) {
    return new Promise((resolve, reject) => {
        const process = exec(command, (error, stdout, stderr) => {
            if (error) {
                fs.appendFileSync(logFilePath, `❌ Error: ${stderr}\n`);
                return reject(error);
            }
            fs.appendFileSync(logFilePath, stdout);
            resolve(stdout);
        });

        process.stdout.on("data", (data) => fs.appendFileSync(logFilePath, data));
        process.stderr.on("data", (data) => fs.appendFileSync(logFilePath, data));
    });
}

async function processDEX(dex) {
    const logFilePath = path.join(__dirname, `../logs/dex-logs/${dex.name.toLowerCase()}-log.txt`);
    try {
        console.log(`🚀 Processing DEX: ${dex.name}...`);
        
        // Update .env dynamically
        const envPath = "./.env";
        const currentEnv = fs.readFileSync(envPath, "utf8");
        const updatedEnv = currentEnv
            .replace(/API_URL=.*/, `API_URL=${dex.url}`)
            .replace(/DEX_NAME=.*/, `DEX_NAME=${dex.name}`);
        fs.writeFileSync(envPath, updatedEnv);

        console.log(`✅ Updated .env for ${dex.name}:
    API_URL=${dex.url}
    DEX_NAME=${dex.name}`);

        // Run schema analysis
        console.log(`📊 Running schema analysis for ${dex.name}...`);
        await runCommand("node tools/analyze-and-generate.js", logFilePath);

        // Run fetcher
        console.log(`📡 Fetching and filtering data for ${dex.name}...`);
        const fetcherCommand = `node data-collection/fetch-template.js`;
        await runCommand(fetcherCommand, logFilePath);

        console.log(`✅ ${dex.name} processing completed successfully!`);
    } catch (error) {
        fs.appendFileSync(logFilePath, `❌ Error processing ${dex.name}: ${error.message}\n`);
        console.error(`❌ Error processing ${dex.name}:`, error);
    }
}

async function masterAutomation() {
    console.log("✅ Ensuring logs directory exists...");
    const logDir = path.join(__dirname, "../logs/dex-logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

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
