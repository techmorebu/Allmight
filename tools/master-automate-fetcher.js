require("dotenv").config();
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

// Default DEXs and their APIs
const DEX_APIS = [
    { name: "Quickswap", api: "https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g" },
    { name: "Uniswap", api: "https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV" },
    { name: "Sushiswap", api: "https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/3oHCddbQGTi42kPZBwyGzD2JzZR33zK2MwXtxAerNJy2" },
    { name: "Balancer_Polygon", api: "https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/H9oPAbXnobBRq1cB3HDmbZ1E8MWQyJYQjT1QDJMrdbNp" },
    { name: "Balancer_Optimism", api: "https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/FsmdxmvBJLGjUQPxKMRtcWKzuCNpomKuMTbSbtRtggZ7" },
    { name: "Balancer_Arbitrum", api: "https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/98cQDy6tufTJtshDCuhh9z2kWXsQWBHVh2bqnLHsGAeS" },
];

// Function to dynamically update the `.env` file
function updateEnv(dexName, apiUrl) {
    const envPath = path.resolve(__dirname, "../.env");
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";

    // Check if the DEX is already in `.env`
    const dexKey = dexName.toUpperCase().replace(/-/g, "_") + "_API";
    if (!envContent.includes(dexKey)) {
        // Append the DEX API to `.env`
        envContent += `\n${dexKey}=${apiUrl}`;
        fs.writeFileSync(envPath, envContent, "utf-8");
        console.log(`✅ Added ${dexName} API to .env`);
    } else {
        console.log(`⚠️ ${dexName} API already exists in .env`);
    }
}

// Function to run a shell command and wait for its completion
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

// Function to process each DEX
async function processDEX(dex) {
    try {
        console.log(`🚀 Processing DEX: ${dex.name}...`);

        // Update `.env` with the DEX API if not present
        updateEnv(dex.name, dex.api);

        // Update API_URL dynamically in the environment
        process.env.API_URL = dex.api;
        process.env.DEX = dex.name;

        console.log("📊 Running schema analysis...");
        await runCommand("node tools/analyze-and-generate.js");

        console.log("📡 Fetching and filtering data...");
        await runCommand("node tools/automate-fetcher.js");

        console.log(`✅ ${dex.name} processing completed successfully!`);
    } catch (error) {
        console.error(`❌ Error processing ${dex.name}:`, error);
    }
}

// Master workflow to process all DEXs
async function masterAutomation() {
    for (const dex of DEX_APIS) {
        await processDEX(dex);
    }
    console.log("🎉 All DEXs processed successfully!");
}

masterAutomation();
