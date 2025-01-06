const fs = require("fs");
const path = require("path");

const dexFiles = [
    "logs/final-pools-Quickswap.json",
    "logs/final-pools-Uniswap.json",
    "logs/final-pools-Sushiswap.json",
];

function mergeData() {
    try {
        let combinedData = [];

        dexFiles.forEach((file) => {
            if (fs.existsSync(file)) {
                console.log(`📂 Merging data from ${file}...`);
                const data = JSON.parse(fs.readFileSync(file, "utf8"));
                combinedData = combinedData.concat(data);
            } else {
                console.warn(`⚠️ File not found: ${file}`);
            }
        });

        const outputPath = "./logs/merged-pools.json";
        fs.writeFileSync(outputPath, JSON.stringify(combinedData, null, 2));
        console.log(`✅ All data merged into ${outputPath}`);
    } catch (error) {
        console.error("❌ Error merging data:", error);
    }
}

mergeData();
