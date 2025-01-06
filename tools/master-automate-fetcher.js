require("dotenv").config();
const { exec } = require("child_process");
const fs = require("fs");

// Extract all API URLs from .env dynamically
const DEX_APIS = Object.entries(process.env)
    .filter(([key]) => key.endsWith("_API"))
    .map(([key, value]) => ({
        name: key.replace("_API", ""), // Extract DEX name from the key
        url: value,
    }));

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

        // Update API_URL dynamically in .env
        const envPath = "./.env";
        const currentEnv = fs.readFileSync(envPath, "utf8");
        const updatedEnv = currentEnv.replace(/API_URL=.*/, `API_URL=${dex.url}`);
        fs.writeFileSync(envPath, updatedEnv);

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
