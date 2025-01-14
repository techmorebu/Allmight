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
const testOutputDir = path.join(outputDir, "apitests");
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

  async function updateFolderContents(folderPath, apiName, data) {
    const filePath = path.join(folderPath, `${apiName}-fields.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Saved data for ${apiName} to ${filePath}`);
  }

  for (const [apiName, apiUrl] of Object.entries(apis)) {
    const { schema, error } = await fetchApiSchema(apiName, apiUrl);
    const data = { schema, error };
    await updateFolderContents(outputFolder, apiName, data);
  }

  console.log(`Mapper run completed. Results saved in ${outputFolder}`);
}

// Cross-Referencing Functionality
function runCrossReference() {
  console.log("Running Cross-Referencing...");

  const requiredFields = [
    "token0Price",
    "token1Price",
    "volumeUSD",
    "feesUSD",
    "liquidity",
    "txCount",
    "open",
    "high",
    "low",
    "close",
    "totalValueLockedUSD",
  ];

  const fieldSynonyms = {
    token0Price: ["price0", "priceToken0", "baseTokenPrice", "price_base", "token0_rate"],
    token1Price: ["price1", "priceToken1", "quoteTokenPrice", "price_quote", "token1_rate"],
    volumeUSD: ["usdVolume", "tradingVolumeUSD", "volume_usd", "totalVolumeUSD", "tradeVolumeUSD"],
    feesUSD: ["usdFees", "tradingFeesUSD", "fees_usd", "totalFeesUSD", "feeVolumeUSD"],
    liquidity: ["poolLiquidity", "totalLiquidity", "liquidityUSD", "currentLiquidity", "availableLiquidity"],
    txCount: ["transactionCount", "tx_count", "tradeCount", "swapCount", "numberOfTransactions"],
    open: ["openingPrice", "openPrice", "price_open", "startPrice"],
    high: ["highestPrice", "highPrice", "price_high", "maxPrice"],
    low: ["lowestPrice", "lowPrice", "price_low", "minPrice"],
    close: ["closingPrice", "closePrice", "price_close", "endPrice"],
    totalValueLockedUSD: ["TVL", "lockedValueUSD", "totalLiquidityUSD", "valueLockedUSD", "tvl_usd"],
};

  const fieldWeights = {
    token0Price: 3,
    token1Price: 3,
    volumeUSD: 2,
    feesUSD: 2,
    liquidity: 1,
    txCount: 1,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    totalValueLockedUSD: 2,
  };

  function matchFields(fields, requiredField) {
    const synonyms = fieldSynonyms[requiredField] || [];
    return fields.some((f) => f === requiredField || synonyms.includes(f));
  }

  const dataFiles = fs.readdirSync(outputDir).filter((file) => file.endsWith("-fields.json"));
  const report = {};

  dataFiles.forEach((file) => {
    const apiName = path.basename(file, "-fields.json");
    const filePath = path.join(outputDir, file);
    const { schema } = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const fields = schema ? schema.flatMap((type) => (type.fields || []).map((f) => f.name)) : [];

    const matched = requiredFields.filter((field) => matchFields(fields, field));
    const missing = requiredFields.filter((field) => !matchFields(fields, field));
    const weightedScore = matched.reduce((sum, field) => sum + (fieldWeights[field] || 0), 0);

    if (fields.length === 0) {
      console.warn(`No fields found for API: ${apiName}. Schema might be incomplete or malformed.`);
    }

    report[apiName] = { matched, missing, weightedScore };
  });

  const reportPath = path.join(outputDir, "cross-reference-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Cross-Referencing Report saved to ${reportPath}`);
}

// Arbitrage Execution Functionality
async function executeArbitrage() {
  console.log("Starting Arbitrage Execution...");
  const opportunities = [{ mockOpportunity: true, netProfit: 0.1 }]; // Placeholder for detected opportunities

  for (const opportunity of opportunities) {
    console.log("Executing opportunity:", opportunity);
    // Execution logic goes here
  }

  console.log("Arbitrage Execution completed.");
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

  rl.question("Enter your choice: ", async (choice) => {
    switch (choice.trim()) {
      case "1":
        await runMapper(outputDir);
        break;
      case "2":
        runCrossReference();
        break;
      case "3":
        await executeArbitrage();
        break;
      default:
        console.log("Invalid choice.");
    }
    rl.close();
    mainMenu();
  });
}

mainMenu();
