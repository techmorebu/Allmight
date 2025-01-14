const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
require("dotenv").config();

const outputDir = path.resolve(__dirname, "../outputs");
const testOutputDir = path.join(outputDir, "apitests");
const fullTestOutputDir = path.join(outputDir, "fulltests");

// Ensure output directories exist
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
if (!fs.existsSync(testOutputDir)) fs.mkdirSync(testOutputDir, { recursive: true });
if (!fs.existsSync(fullTestOutputDir)) fs.mkdirSync(fullTestOutputDir, { recursive: true });

// Map your API endpoints from .env
const apis = {
  uniswap: process.env.UNISWAP_DEX_API,
  sushiswap: process.env.SUSHISWAP_DEX_API,
  curveEthereum: process.env.CURVE_ETHEREUM_DEX_API,
  curveAvalanche: process.env.CURVE_AVALANCHE_DEX_API,
  quickswap: process.env.QUICKSWAP_DEX_API,
  balancerPolygon: process.env.BALANCER_POLYGON_DEX_API,
  balancerOptimism: process.env.BALANCER_OPTIMISM_DEX_API,
  balancerArbitrum: process.env.BALANCER_ARBITRUM_DEX_API,
  balancerAvalanche: process.env.BALANCER_AVALANCHE_DEX_API,
  balancerEthereum: process.env.BALANCER_ETHEREUM_DEX_API,
};

// Helper function to fetch schema or data
async function fetchApiSchema(apiName, apiUrl) {
  console.log(`Fetching schema for ${apiName} (${apiUrl})...`);
  const startTime = Date.now();
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `{
          __schema {
            types {
              name
              kind
              fields {
                name
                type {
                  name
                  kind
                  ofType {
                    name
                    kind
                  }
                }
              }
            }
          }
        }`,
      }),
    });

    const duration = Date.now() - startTime;
    console.log(`API response time for ${apiName}: ${duration}ms`);

    if (!response.ok) {
      throw new Error(`Failed to fetch schema: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.data || !data.data.__schema) {
      throw new Error("Not a valid GraphQL endpoint.");
    }

    console.log(`Successfully fetched schema for ${apiName}.`);
    return { schema: data.data.__schema.types, responseTime: duration };
  } catch (error) {
    console.error(`Error fetching schema for ${apiName}:`, error.message);
    return { schema: null, error: error.message, responseTime: null };
  }
}

// Save JSON output
function saveJsonOutput(folder, fileName, data) {
  const dirPath = path.join(outputDir, folder);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

  const filePath = path.join(dirPath, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Output saved to ${filePath}`);
}

// Update folder contents
function updateFolderContents(folderPath, apiName, data) {
  const existingFiles = fs.readdirSync(folderPath).filter(file => file.endsWith("-fields.json"));
  const apiFileName = `${apiName}-fields.json`;
  const apiFilePath = path.join(folderPath, apiFileName);

  // Overwrite or add new file
  fs.writeFileSync(apiFilePath, JSON.stringify(data, null, 2));
  console.log(`Updated file: ${apiFilePath}`);

  // Remove files not part of the current run
  const filesToRemove = existingFiles.filter(file => !Object.keys(apis).includes(file.replace("-fields.json", "")));
  filesToRemove.forEach(file => {
    fs.unlinkSync(path.join(folderPath, file));
    console.log(`Removed outdated file: ${file}`);
  });
}

// Consolidate Results
function consolidateResults(folderPath, consolidatedFileName) {
  console.log("Consolidating results...");
  const files = fs.readdirSync(folderPath).filter(file => file.endsWith(".json"));
  const consolidatedResults = { metadata: { apiCount: 0, totalFields: 0, missingFields: [] }, data: {} };

  files.forEach(file => {
    const filePath = path.join(folderPath, file);
    const apiName = file.replace("-fields.json", "");
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    consolidatedResults.data[apiName] = data;
    consolidatedResults.metadata.apiCount += 1;

    if (data.schema) {
      consolidatedResults.metadata.totalFields += data.schema.reduce((sum, type) => sum + (type.fields ? type.fields.length : 0), 0);
    } else {
      consolidatedResults.metadata.missingFields.push(apiName);
    }
  });

  const consolidatedFilePath = path.join(folderPath, consolidatedFileName);
  fs.writeFileSync(consolidatedFilePath, JSON.stringify(consolidatedResults, null, 2));
  console.log(`Consolidated results saved to ${consolidatedFilePath}`);
}

// Clear Full Test Folder
function clearFullTestFolder() {
  console.log("Clearing full test folder...");
  const files = fs.readdirSync(fullTestOutputDir);
  files.forEach(file => {
    fs.unlinkSync(path.join(fullTestOutputDir, file));
    console.log(`Removed file: ${file}`);
  });
  console.log("Full test folder cleared.");
}

// Main Mapper Function
async function runMapper(outputFolder) {
  console.log(`Running mapper for all APIs. Output folder: ${outputFolder}`);

  for (const [apiName, apiUrl] of Object.entries(apis)) {
    try {
      const { schema, responseTime, error } = await fetchApiSchema(apiName, apiUrl);
      const data = { schema, responseTime, error };
      updateFolderContents(outputFolder, apiName, data);
    } catch (error) {
      console.error(`Error during mapper run for ${apiName}:`, error.message);
    }
  }
  const consolidatedFileName = outputFolder === fullTestOutputDir ? "consolidated-fulltests.json" : "consolidated-results.json";
  consolidateResults(outputFolder, consolidatedFileName);
  console.log(`Mapper run completed. Results saved in ${outputFolder}`);
}

// Exports for integration
module.exports = {
  runMapper,
  outputDir,
  testOutputDir,
  fullTestOutputDir,
  clearFullTestFolder,
};
