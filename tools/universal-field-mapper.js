const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const refinedDataDir = path.join(outputDir, "refined_data");
const schemaAnalysisFile = path.join(outputDir, "schema-analysis.json");

// Map your API endpoints from .env
const apis = {
  sushiswap: process.env.SUSHISWAP_DEX_API,
  balancer: process.env.BALANCER_DEX_API,
  curve: process.env.CURVE_DEX_API,
};

// Ensure output directories exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}
if (!fs.existsSync(refinedDataDir)) {
  fs.mkdirSync(refinedDataDir);
}

// Refined queries for each API
const refinedQueries = {
  sushiswap: `{
    liquiditypool {
      id
      liquidity
      volumeUSD
      txCount
      feesUSD
      token0 { symbol priceUSD }
      token1 { symbol priceUSD }
    }
    liquidityPoolDailySnapshot {
      day
      totalValueLockedUSD
      dailyVolumeUSD
      dailyTotalRevenueUSD
    }
    swap {
      timestamp
      amountUSD
    }
  }`,
  balancer: `{
    pool {
      id
      liquidity
      totalSwapVolume
      totalSwapFee
      totalLiquidity
      tokens {
        symbol
        priceUSD
      }
      poolSnapshots {
        timestamp
        liquidity
        swapVolume
      }
    }
  }`,
  curve: `{
    liquiditypool {
      id
      liquidity
      volumeUSD
      txCount
      rewardTokenEmissionsUSD
    }
    liquidityPoolDailySnapshot {
      day
      totalValueLockedUSD
      dailyVolumeUSD
      dailyProtocolSideRevenueUSD
    }
  }`,
};

// Function to execute a GraphQL query
async function executeQuery(apiName, url, query) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch data for ${apiName}: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.data) {
      return data.data;
    } else {
      console.warn(`No data returned for ${apiName}:`, data);
      return {};
    }
  } catch (error) {
    console.error(`Error executing query for ${apiName}:`, error.message);
    return {};
  }
}

// Fetch and save refined data for all APIs
async function fetchAndSaveRefinedData() {
  const consolidatedData = {};

  for (const [apiName, apiUrl] of Object.entries(apis)) {
    console.log(`Fetching refined data for ${apiName}...`);
    const query = refinedQueries[apiName];

    if (!query) {
      console.warn(`No query defined for ${apiName}, skipping.`);
      continue;
    }

    const result = await executeQuery(apiName, apiUrl, query);
    if (Object.keys(result).length > 0) {
      consolidatedData[apiName] = result;

      // Save individual API result
      const outputFile = path.join(refinedDataDir, `${apiName}_refined_data.json`);
      fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
      console.log(`Refined data for ${apiName} saved to ${outputFile}`);
    }
  }

  // Save consolidated data
  const consolidatedFile = path.join(refinedDataDir, "consolidated_refined_data.json");
  fs.writeFileSync(consolidatedFile, JSON.stringify(consolidatedData, null, 2));
  console.log(`Consolidated refined data saved to ${consolidatedFile}`);
}

// Run the mapper to fetch refined data
(async () => {
  try {
    await fetchAndSaveRefinedData();
    console.log("Refined data fetch and save completed.");
  } catch (error) {
    console.error("Error during refined data fetching:", error.message);
  }
})();
