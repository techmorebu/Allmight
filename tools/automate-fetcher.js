require("dotenv").config();
const { exec } = require("child_process");
const path = require("path");

async function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    exec(`node ${scriptPath}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Error running script ${scriptPath}:`, stderr);
        reject(error);
      } else {
        console.log(`✅ Script ${scriptPath} completed successfully.`);
        console.log(stdout);
        resolve();
      }
    });
  });
}

async function automateFetcher() {
  try {
    console.log("🚀 Starting automated workflow for Quickswap...");
    const analyzeScript = path.resolve(__dirname, "../tools/analyze-and-generate.js");
    const fetcherScript = path.resolve(__dirname, "../data-collection/fetch-quickswap-data.js");

    console.log("📊 Running schema analysis...");
    await runScript(analyzeScript);

    console.log("📡 Running data fetcher...");
    await runScript(fetcherScript);

    console.log("🎉 Automated workflow completed successfully!");
  } catch (error) {
    console.error("❌ Error in automateFetcher workflow:", error);
  }
}

automateFetcher();
