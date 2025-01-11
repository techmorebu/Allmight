const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const testOutputDir = path.join(outputDir, "apitests");

// Ensure output directories exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}
if (!fs.existsSync(testOutputDir)) {
  fs.mkdirSync(testOutputDir);
}

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

// Function to determine API type (placeholder logic for now)
function determineApiType(apiUrl) {
  if (apiUrl.includes("wss://")) {
    return "WebSocket";
  } else if (apiUrl.includes("graphql")) {
    return "GraphQL";
  } else if (apiUrl.includes("rest")) {
    return "RESTful";
  } else {
    return "Aggregator";
  }
}

// Test API functionality
async function testApi(apiName, apiUrl) {
  console.log(`Testing API: ${apiName} (${apiUrl})`);
  const apiType = determineApiType(apiUrl);
  const testResult = {
    apiName,
    apiUrl,
    apiType,
    status: "", // success or error
    sampleData: null,
    errorMessage: null,
  };

  try {
    if (apiType === "GraphQL") {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ __typename }" }),
      });
      if (!response.ok) {
        throw new Error(`API Test Failed: ${response.statusText}`);
      }
      const data = await response.json();
      testResult.status = "success";
      testResult.sampleData = data;
    } else {
      testResult.status = "unsupported";
      testResult.errorMessage = `API type '${apiType}' is not supported for testing yet.`;
    }
  } catch (error) {
    testResult.status = "error";
    testResult.errorMessage = error.message;
  }

  const testFilePath = path.join(testOutputDir, `${apiName}-test.json`);
  fs.writeFileSync(testFilePath, JSON.stringify(testResult, null, 2));
  console.log(`Test result saved to ${testFilePath}`);
}

// Clear all test files
function clearTestFiles() {
  const files = fs.readdirSync(testOutputDir);
  files.forEach((file) => {
    fs.unlinkSync(path.join(testOutputDir, file));
  });
  console.log("All test files cleared.");
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
        console.log("Test Options:");
        console.log("1. Run New Test (Clear All Files)");
        console.log("2. Retry (Overwrite Existing Files)");

        rl.question("Enter your test option: ", async (testOption) => {
          switch (testOption.trim()) {
            case "1":
              clearTestFiles();
              rl.question("Enter API name to test: ", (apiName) => {
                rl.question("Enter API URL to test: ", async (apiUrl) => {
                  await testApi(apiName, apiUrl);
                  rl.close();
                });
              });
              break;
            case "2":
              rl.question("Enter API name to test: ", (apiName) => {
                rl.question("Enter API URL to test: ", async (apiUrl) => {
                  await testApi(apiName, apiUrl); // Overwrites existing files
                  rl.close();
                });
              });
              break;
            default:
              console.log("Invalid test option.");
              rl.close();
              break;
          }
        });
        break;
      default:
        console.log("Invalid choice.");
        rl.close();
        break;
    }
  });
}

// Main function to run the mapper
async function runMapper() {
  for (const [apiName, apiUrl] of Object.entries(apis)) {
    const schema = await fetchApiSchema(apiName, apiUrl);
    if (schema) {
      const fields = Array.isArray(schema)
        ? processSchema(schema, apiName)
        : schema;

      const dateStamp = new Date().toISOString().split("T")[0];
      const jsonFileName = `${apiName}-fields-${dateStamp}.json`;
      const csvFileName = `${apiName}-fields-${dateStamp}.csv`;
      const htmlFileName = `${apiName}-fields-${dateStamp}.html`;

      saveJsonOutput(jsonFileName, fields, apiName);
      saveCsvOutput(csvFileName, fields, apiName);
      saveHtmlOutput(htmlFileName, fields, apiName);
    }
  }
  console.log("Field mapping completed for all APIs.");
}

// Start the interactive prompt
startInteractivePrompt();
