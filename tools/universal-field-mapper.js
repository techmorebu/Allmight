const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const testOutputDir = path.join(outputDir, "apitests");
const fullTestOutputDir = path.join(outputDir, "fulltests");

// Ensure output directories exist
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
if (!fs.existsSync(testOutputDir)) fs.mkdirSync(testOutputDir);
if (!fs.existsSync(fullTestOutputDir)) fs.mkdirSync(fullTestOutputDir);

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
    return data.data.__schema.types;
  } catch (error) {
    console.error(`Error fetching schema for ${apiName}:`, error.message);
    return null;
  }
}

// Validate critical fields
function validateCriticalFields(apiName, schema) {
  const criticalFields = ["minPrice", "maxPrice"];
  const invalidFields = criticalFields.filter(field => {
    return !schema.some(type =>
      type.fields && type.fields.some(f => f.name === field && f.type && f.type.name)
    );
  });

  if (invalidFields.length > 0) {
    console.warn(
      `Warning: Missing critical fields in ${apiName}: ${invalidFields.join(", ")}`
    );
  }
}

// Save JSON output
function saveJsonOutput(folder, fileName, data) {
  const dirPath = path.join(outputDir, folder);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);

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
  const consolidatedResults = {};

  files.forEach(file => {
    const filePath = path.join(folderPath, file);
    const apiName = file.replace("-fields.json", "");
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    consolidatedResults[apiName] = data;
  });

  const consolidatedFilePath = path.join(folderPath, consolidatedFileName);
  fs.writeFileSync(consolidatedFilePath, JSON.stringify(consolidatedResults, null, 2));
  console.log(`Consolidated results saved to ${consolidatedFilePath}`);
}

// Main Mapper Function
async function runMapper() {
  console.log("Running mapper for all APIs...");

  for (const [apiName, apiUrl] of Object.entries(apis)) {
    try {
      const schema = await fetchApiSchema(apiName, apiUrl);
      if (schema) {
        validateCriticalFields(apiName, schema);
        updateFolderContents(outputDir, apiName, schema);
      }
    } catch (error) {
      console.error(`Error during mapper run for ${apiName}:`, error.message);
    }
  }
  consolidateResults(outputDir, "consolidated-results.json");
  console.log("Mapper run completed. Results saved in ./outputs/");
}

// Interactive Prompt
function startInteractivePrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Select an option:");
  console.log("1. Update Mapper");
  console.log("2. Add New API");
  console.log("3. Test");
  console.log("4. Full Test");

  rl.question("Enter your choice: ", async (choice) => {
    switch (choice.trim()) {
      case "1":
        console.log("Updating Mapper...");
        await runMapper();
        break;
      case "2":
        rl.question("Enter new API name: ", (apiName) => {
          rl.question("Enter new API URL: ", (apiUrl) => {
            apis[apiName] = apiUrl;
            console.log(`Added new API: ${apiName} -> ${apiUrl}`);
            rl.close();
          });
        });
        break;
      case "3":
        rl.question("Enter API name to test: ", (apiName) => {
          rl.question("Enter API URL to test: ", async (apiUrl) => {
            await testApi(apiName, apiUrl);
            rl.close();
          });
        });
        break;
      case "4":
        console.log("Running full test...");
        await runMapper();
        rl.close();
        break;
      default:
        console.log("Invalid choice.");
        rl.close();
        break;
    }
  });
}

// Start the interactive prompt
startInteractivePrompt();
