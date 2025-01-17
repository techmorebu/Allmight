// Hybrid Arbitrage System
// Fully integrates Universal Mapper, Cross-Reference Script, and Opportunity Detection

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const ethers = require("ethers");
const ethers67 = require("ethers67");
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");
require("dotenv").config();

const outputDir = path.resolve(__dirname, "../outputs");
const testOutputDir = path.join(outputDir, "tests");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
if (!fs.existsSync(testOutputDir)) fs.mkdirSync(testOutputDir, { recursive: true });

const config = {
  dexApis: JSON.parse(process.env.DEX_APIS || "[]"),
  minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || "0.05"),
};

console.log(`Using ethers version for Hybrid Arbitrage: ${ethers.version}`);
console.log(`Using ethers version for Flashbots: ${ethers67.version}`);

// Utility Functions
function clearFolderExcept(folderPath, ignoreFiles) {
  if (fs.existsSync(folderPath)) {
    const files = fs.readdirSync(folderPath);
    files.forEach((file) => {
      if (!ignoreFiles.includes(file)) {
        fs.unlinkSync(path.join(folderPath, file));
        console.log(`Deleted file: ${file}`);
      }
    });
    console.log(`Cleared folder except ignored files: ${folderPath}`);
  } else {
    console.log(`Folder does not exist: ${folderPath}`);
  }
}

function addApiToEnv(tag, url) {
  const envPath = path.resolve(__dirname, "../.env");
  const newEntry = `${tag}=${url}\n`;

  if (fs.existsSync(envPath)) {
    fs.appendFileSync(envPath, newEntry);
    console.log(`Added API to .env: ${tag}`);
  } else {
    console.log(".env file not found. Cannot add API.");
  }
}

function removeApiFromEnv(tag) {
  const envPath = path.resolve(__dirname, "../.env");

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8").split("\n");
    const updatedContent = envContent.filter((line) => !line.startsWith(tag));
    fs.writeFileSync(envPath, updatedContent.join("\n"));
    console.log(`Removed API from .env: ${tag}`);
  } else {
    console.log(".env file not found. Cannot remove API.");
  }
}

// Universal Mapper Functionality
async function runMapper(outputFolder) {
  console.log(`Running mapper for all APIs. Output folder: ${outputFolder}`);

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

  async function fetchApiSchema(apiName, apiUrl) {
    console.log(`Fetching schema for ${apiName} (${apiUrl})...`);
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
                      ofType {
                        name
                        kind
                      }
                    }
                  }
                }
              }
            }
          }`,
        }),
      });
      if (!response.ok) throw new Error(`Failed to fetch schema: ${response.statusText}`);
      const data = await response.json();
      if (!data.data || !data.data.__schema) throw new Error("Not a valid GraphQL endpoint.");
      return { schema: data.data.__schema.types };
    } catch (error) {
      console.error(`Error fetching schema for ${apiName}:`, error.message);
      return { schema: null, error: error.message };
    }
  }

  async function extractNestedFields(schema) {
    const fields = [];

    function recurse(type) {
      if (!type || !type.fields) return;
      type.fields.forEach((field) => {
        fields.push(field.name);
        if (field.type?.ofType) {
          recurse(field.type.ofType);
        }
      });
    }

    schema.forEach((type) => {
      recurse(type);
    });

    return fields;
  }

  async function updateFolderContents(folderPath, apiName, data) {
    const filePath = path.join(folderPath, `${apiName}-fields.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Saved data for ${apiName} to ${filePath}`);
  }

  for (const [apiName, apiUrl] of Object.entries(apis)) {
    const { schema, error } = await fetchApiSchema(apiName, apiUrl);
    const fields = schema ? await extractNestedFields(schema) : [];
    const data = { schema, fields, error };
    await updateFolderContents(outputFolder, apiName, data);
  }

  console.log(`Mapper run completed. Results saved in ${outputFolder}`);
}

// Main Interactive Menu
function mainMenu() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\nSelect an option:");
  console.log("1. Run Universal Mapper");
  console.log("2. Run Cross-Referencing");
  console.log("3. Perform Arbitrage Execution");
  console.log("4. Options");

  rl.question("Enter your choice: ", async (choice) => {
    switch (choice.trim()) {
      case "1":
        await runMapper(outputDir);
        break;
      case "2":
        console.log("Running Cross-Referencing...");
        break;
      case "3":
        console.log("Performing Arbitrage Execution...");
        break;
      case "4":
        console.log("Options:\n1. Add API\n2. Remove API\n3. Clear All (Excluding Specific Files)");
        rl.question("Select an option: ", (option) => {
          switch (option.trim()) {
            case "1":
              rl.question("Enter API tag: ", (tag) => {
                rl.question("Enter API URL: ", (url) => {
                  addApiToEnv(tag, url);
                  rl.close();
                  mainMenu();
                });
              });
              break;
            case "2":
              rl.question("Enter API tag to remove: ", (tag) => {
                removeApiFromEnv(tag);
                rl.close();
                mainMenu();
              });
              break;
            case "3":
              clearFolderExcept(outputDir, ["fulltests", "debug"]);
              rl.close();
              mainMenu();
              break;
            default:
              console.log("Invalid option.");
              rl.close();
              mainMenu();
          }
        });
        break;
      default:
        console.log("Invalid choice.");
        rl.close();
        mainMenu();
    }
  });
}

mainMenu();
