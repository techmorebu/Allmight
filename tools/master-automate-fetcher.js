require("dotenv").config();
const fs = require("fs");
const { exec } = require("child_process");

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
                console.error(`❌ Command Error: ${stderr}`);
                return reject(error);
            }
            resolve(stdout);
        });
    });
}

async function processDEX(dex) {
    try {
        if (!dex.url) {
            console.warn(`⚠️ Skipping ${dex.name}: API URL not defined.`);
            return;
        }

        console.log(`🚀 Processing DEX: ${dex.name}`);
        const envPath = "./.env";
        const currentEnv = fs.readFileSync(envPath, "utf-8");
        const updatedEnv = currentEnv
            .replace(/API_URL=.*/, `API_URL=${dex.url}`)
            .replace(/DEX_NAME=.*/, `DEX_NAME=${dex.name}`);
        fs.writeFileSync(envPath, updatedEnv);
        console.log(`✅ Updated .env for ${dex.name}:\n    API_URL=${dex.url}\n    DEX_NAME=${dex.name}`);

        console.log(`📊 Running schema analysis for ${dex.name}...`);
        const analyzeOutput = await runCommand("node tools/analyze-and-generate.js");
        console.log(analyzeOutput);

        console.log(`📡 Fetching and filtering data for ${dex.name}...`);
        const fetchOutput = await runCommand("node data-collection/fetch-template.js");
        console.log(fetchOutput);

        console.log(`✅ ${dex.name} processing completed successfully!`);
    } catch (error) {
        console.error(`❌ Error processing ${dex.name}:`, error.message);
    }
}

async function masterAutomation() {
    for (const dex of DEX_APIS) {
        await processDEX(dex);
    }
    console.log("🎉 All DEXs processed successfully!");
}

masterAutomation();
