require("dotenv").config();
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

// List of DEX APIs from .env
const DEX_APIS = [
    { name: "Quickswap", url: process.env.QUICKSWAP_API },
    { name: "Uniswap", url: process.env.UNISWAP_API },
    { name: "Sushiswap", url: process.env.SUSHISWAP_API },
    { name: "Balancer-Polygon", url: process.env.BALANCER_POLYGON_API },
    { name: "Balancer-Optimism", url: process.env.BALANCER_OPTIMISM_API },
    { name: "Balancer-Arbitrum", url: process.env.BALANCER_ARBITRUM_API },
    { name: "Balancer-Avalanche", url: process.env.BALANCER_AVALANCHE_API },
    { name: "Balancer-Ethereum", url: process.env.BALANCER_ETHEREUM_API },
    { name: "Curve-Ethereum", url: process.env.CURVE_FINANCE_ETHEREUM_API },
    { name: "Curve-Avalanche", url: process.env.CURVE_FINANCE_AVALANCHE_API },
    // Add more DEXs or networks as needed
];

async function runCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Error: ${stderr}`);
                return reject(error);
            }
            console.log(stdout);
            resolve(stdout);
        });
    });
}

async function processDEX(dex) {
    try {
        console.log(`🚀 Processing DEX: ${dex.name}...`);

        // Ensure correct API URL replacement
        if (!dex.url) {
            throw new Error(`API URL for ${dex.name} is not defined.`);
        }

        const envPath = "./.env";
        const currentEnv = fs.readFileSync(envPath, "utf8");
        const updatedEnv = currentEnv.replace(/API_URL=.*/, `API_URL=${dex.url}`);
        fs.writeFileSync(envPath, updatedEnv);

        console.log(`📡 Using API URL: ${dex.url}`);

        console.log("📊 Running schema analysis...");
        await runCommand("node tools/analyze-and-generate.js");

        console.log("📡 Fetching and filtering data...");
        await runCommand("node tools/automate-fetcher.js");

        console.log(`✅ ${dex.name} processing completed successfully!`);
    } catch (error) {
        console.error(`❌ Error processing ${dex.name}:`, error);
    }
}

async function masterAutomation() {
    const consolidatedData = [];

    for (const dex of DEX_APIS) {
        if (!dex.url) {
            console.warn(`⚠️ Skipping ${dex.name}: API URL not defined.`);
            continue;
        }
        await processDEX(dex, consolidatedData);
    }

    // Save consolidated data to a single file
    const consolidatedPath = "./logs/consolidated-pools.json";
    fs.writeFileSync(consolidatedPath, JSON.stringify(consolidatedData, null, 2));
    console.log(`🎉 Consolidated data saved to ${consolidatedPath}`);
    console.log("🎉 All DEXs processed successfully!");
}

masterAutomation();
