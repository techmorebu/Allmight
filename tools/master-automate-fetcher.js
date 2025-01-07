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

async function runCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Error: ${stderr}`);
                return reject(error);
            }
            resolve(stdout);
        });
    });
}

async function processDEX(dex) {
    try {
        console.log(`🚀 Processing DEX: ${dex.name}...`);
        console.log(`🔧 Using API URL: ${dex.url}`);
        
        const envPath = "./.env";
        const currentEnv = fs.readFileSync(envPath, "utf8");
        const updatedEnv = currentEnv
            .replace(/API_URL=.*/, `API_URL=${dex.url}`)
            .replace(/DEX_NAME=.*/, `DEX_NAME=${dex.name}`);
        fs.writeFileSync(envPath, updatedEnv);

        console.log(fs.readFileSync(envPath, "utf8")); // Debugging the .env content

        console.log(`📊 Running schema analysis for ${dex.name}...`);
        const logPathAnalyze = path.join(__dirname, `logs/${dex.name}-analyze-log.txt`);
        await runCommand(`node tools/analyze-and-generate.js > ${logPathAnalyze} 2>&1`);
        console.log(`📄 Analyze logs written to: ${logPathAnalyze}`);

        console.log(`📡 Fetching and filtering data for ${dex.name}...`);
        const fetcherScript = `data-collection/fetch-${dex.name.toLowerCase()}-data.js`;
        const logPathFetch = path.join(__dirname, `logs/${dex.name}-fetch-log.txt`);
        if (fs.existsSync(fetcherScript)) {
            await runCommand(`node ${fetcherScript} > ${logPathFetch} 2>&1`);
        } else {
            console.warn(`⚠️ Fetcher script for ${dex.name} not found. Using fetch-template.js.`);
            await runCommand(`node data-collection/fetch-template.js > ${logPathFetch} 2>&1`);
        }
        console.log(`📄 Fetch logs written to: ${logPathFetch}`);

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
