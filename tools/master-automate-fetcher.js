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
    { name: "Balancer_Optimism", url: process.env.BALANCER_OPTIMISIM_API },
    { name: "Balancer_Arbitrum", url: process.env.BALANCER_ARBITRUM_API },
    { name: "Balancer_Avalanche", url: process.env.BALANCER_AVALANCHE_API },
    { name: "Balancer_Ethereum", url: process.env.BALANCER_ETHEREUM_API }
];

// Ensure the logs directory exists
const logsDir = path.join(__dirname, "../logs");
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

async function runCommand(command, logFileName) {
    return new Promise((resolve, reject) => {
        const logPath = path.join(logsDir, logFileName);

        const process = exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Error: ${stderr}`);
                fs.appendFileSync(logPath, `❌ Error: ${stderr}\n`);
                return reject(error);
            }
            console.log(stdout);
            fs.appendFileSync(logPath, stdout);
            resolve(stdout);
        });
    });
}

async function processDEX(dex) {
    try {
        console.log(`🚀 Processing DEX: ${dex.name}...`);
        const logFileName = `${dex.name.toLowerCase()}-log.txt`;

        // Update API_URL dynamically
        const envPath = path.join(__dirname, "../.env");
        const currentEnv = fs.readFileSync(envPath, "utf8");
        const updatedEnv = currentEnv.replace(/API_URL=.*/, `API_URL=${dex.url}`);
        fs.writeFileSync(envPath, updatedEnv);

        // Check if API URL exists
        if (!dex.url) {
            console.warn(`⚠️ Skipping ${dex.name}: API URL not defined.`);
            fs.appendFileSync(path.join(logsDir, logFileName), `⚠️ Skipping ${dex.name}: API URL not defined.\n`);
            return;
        }

        console.log("📊 Running schema analysis...");
        await runCommand("node tools/analyze-and-generate.js", logFileName);

        console.log("📡 Fetching and filtering data...");
        await runCommand("node tools/automate-fetcher.js", logFileName);

        console.log(`✅ ${dex.name} processing completed successfully!`);
    } catch (error) {
        console.error(`❌ Error processing ${dex.name}:`, error);
    }
}

async function masterAutomation() {
    for (const dex of DEX_APIS) {
        await processDEX(dex);
    }
    console.log("🎉 All DEXs processed successfully!");
}

masterAutomation();
