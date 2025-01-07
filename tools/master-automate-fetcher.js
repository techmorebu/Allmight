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
    { name: "Balancer_Ethereum", url: process.env.BALANCER_ETHEREUM_API },
    // Add more DEXs as needed
];

// Utility to execute shell commands
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

// Update .env file with the API URL of the current DEX
function updateEnv(dex) {
    const envPath = "./.env";
    const currentEnv = fs.readFileSync(envPath, "utf8");
    const updatedEnv = currentEnv.replace(/API_URL=.*/, `API_URL=${dex.url}`);
    fs.writeFileSync(envPath, updatedEnv);
    console.log(`📡 Using API URL: ${dex.url}`);
}

// Save logs for individual DEXs
async function saveDexLogs(dexName, rawData, filteredData) {
    const logDir = `./logs/${dexName.toLowerCase()}`;
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const rawDataPath = path.join(logDir, "raw-data.json");
    const filteredDataPath = path.join(logDir, "filtered-data.json");

    fs.writeFileSync(rawDataPath, JSON.stringify(rawData, null, 2));
    fs.writeFileSync(filteredDataPath, JSON.stringify(filteredData, null, 2));

    console.log(`✅ Logs saved for ${dexName}:`);
    console.log(`   Raw Data: ${rawDataPath}`);
    console.log(`   Filtered Data: ${filteredDataPath}`);
}

// Consolidate filtered data from all DEXs
async function consolidateData() {
    const combinedFilePath = "./logs/combined-pools.json";
    const logDir = "./logs";

    const combinedData = [];
    const dexDirs = fs.readdirSync(logDir).filter(dir => fs.lstatSync(path.join(logDir, dir)).isDirectory());

    for (const dexDir of dexDirs) {
        const filteredDataPath = path.join(logDir, dexDir, "filtered-data.json");

        if (fs.existsSync(filteredDataPath)) {
            const dexData = JSON.parse(fs.readFileSync(filteredDataPath, "utf8"));
            combinedData.push(...dexData);
        }
    }

    fs.writeFileSync(combinedFilePath, JSON.stringify(combinedData, null, 2));
    console.log(`🎉 Combined data saved to ${combinedFilePath}`);
}

// Generate a fetcher script for a new DEX
function generateFetcherWithVersioning(dex) {
    const templatePath = "./tools/fetcher-template.js";
    const fetcherDir = "./data-collection";
    const baseFileName = `fetch-${dex.name.toLowerCase().replace(/_/g, "-")}-data`;

    if (!fs.existsSync(templatePath)) {
        throw new Error("❌ Fetcher template file not found!");
    }

    const existingFiles = fs.readdirSync(fetcherDir).filter(file => file.startsWith(baseFileName));
    const version = existingFiles.length + 1;
    const fetcherFilePath = `${fetcherDir}/${baseFileName}-v${version}.js`;

    const templateContent = fs.readFileSync(templatePath, "utf8").replace(/DEX_NAME/g, dex.name);
    fs.writeFileSync(fetcherFilePath, templateContent);

    console.log(`✅ New fetcher script generated: ${fetcherFilePath}`);
}

// Process individual DEX
async function processDEX(dex) {
    try {
        console.log(`🚀 Processing DEX: ${dex.name}...`);
        updateEnv(dex);

        console.log("📊 Running schema analysis...");
        await runCommand("node tools/analyze-and-generate.js");

        console.log("🔄 Generating dedicated fetcher script...");
        generateFetcherWithVersioning(dex);

        console.log("📡 Running data fetcher...");
        const fetcherDir = "./data-collection";
        const baseFileName = `fetch-${dex.name.toLowerCase().replace(/_/g, "-")}-data`;
        const fetcherPaths = fs.readdirSync(fetcherDir).filter(file => file.startsWith(baseFileName));

        const latestFetcherPath = `${fetcherDir}/${fetcherPaths.sort().pop()}`;
        await runCommand(`node ${latestFetcherPath}`);

        // Load raw and filtered data from logs
        const rawData = JSON.parse(fs.readFileSync("./logs/raw-data.json", "utf8"));
        const filteredData = JSON.parse(fs.readFileSync("./logs/filtered-data.json", "utf8"));

        // Save logs for the current DEX
        await saveDexLogs(dex.name, rawData, filteredData);

    } catch (error) {
        console.error(`❌ Error processing ${dex.name}:`, error);
    }
}

// Master automation workflow
async function masterAutomation() {
    for (const dex of DEX_APIS) {
        if (!dex.url) {
            console.warn(`⚠️ Skipping ${dex.name}: API URL not defined.`);
            continue;
        }
        await processDEX(dex);
    }

    console.log("📊 Consolidating data from all DEXs...");
    await consolidateData();

    console.log("🎉 All DEXs processed and combined data flow created successfully!");
}

masterAutomation();
