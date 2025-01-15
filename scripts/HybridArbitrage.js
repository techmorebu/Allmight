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
const fullTestOutputDir = path.join(outputDir, "fulltests");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
if (!fs.existsSync(testOutputDir)) fs.mkdirSync(testOutputDir, { recursive: true });
if (!fs.existsSync(fullTestOutputDir)) fs.mkdirSync(fullTestOutputDir, { recursive: true });

const config = {
  dexApis: JSON.parse(process.env.DEX_APIS || "[]"),
  minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || "0.05"),
};

console.log(`Using ethers version for Hybrid Arbitrage: ${ethers.version}`);
console.log(`Using ethers version for Flashbots: ${ethers67.version}`);

// Utility Functions
function clearFolder(folderPath) {
  if (fs.existsSync(folderPath)) {
    const files = fs.readdirSync(folderPath);
    files.forEach((file) => fs.unlinkSync(path.join(folderPath, file)));
    console.log(`Cleared folder: ${folderPath}`);
  } else {
    console.log(`Folder does not exist: ${folderPath}`);
  }
}

async function confirmAction(promptMessage, action) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(promptMessage, (confirmation) => {
    if (confirmation.toLowerCase() === "yes") {
      action();
    } else {
      console.log("Action canceled.");
    }
    rl.close();
  });
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
  console.log("2. Run Universal Mapper (Test Mode)");
  console.log("3. Full Clear Test Folder");
  console.log("4. Full Clear Live Data (Confirm Required)");

  rl.question("Enter your choice: ", async (choice) => {
    switch (choice.trim()) {
      case "1":
        await runMapper(outputDir);
        break;
      case "2":
        await runMapper(testOutputDir);
        break;
      case "3":
        clearFolder(testOutputDir);
        break;
      case "4":
        confirmAction(
          "This will clear the entire live data folder except the test folder. Type 'yes' to confirm: ",
          () => clearFolder(outputDir)
        );
        break;
      default:
        console.log("Invalid choice.");
    }
    rl.close();
    mainMenu();
  });
}

mainMenu();
