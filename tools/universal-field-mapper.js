const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const schemaDir = path.join(outputDir, "schemas");
const consolidatedFile = path.join(outputDir, "consolidated-fields.json");
const rawDataFile = path.join(outputDir, "raw-data.json");
const TRANSACTION_THRESHOLD = 200;
const VOLUME_THRESHOLD = 50000;

// Ensure output and schema directories exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}
if (!fs.existsSync(schemaDir)) {
  fs.mkdirSync(schemaDir);
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

// Fetch pool data dynamically
async function fetchDynamicPoolData(apiUrl, query) {
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch pool data: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error(`Error fetching data from API:`, error.message);
    return null;
  }
}

// Generate and fetch data for all APIs
async function fetchAllData() {
  const consolidatedData = [];

  for (const [apiName, apiUrl] of Object.entries(apis)) {
    console.log(`Fetching data for ${apiName}`);

    const query = `{
      pools(first: 100) {
        id
        txCount
        liquidity
        volumeUSD
        feesUSD
        token0 {
          symbol
          priceUSD
        }
        token1 {
          symbol
          priceUSD
        }
      }
    }`;

    const data = await fetchDynamicPoolData(apiUrl, query);

    if (data && data.pools) {
      consolidatedData.push({
        apiName,
        timestamp: new Date().toISOString(),
        pools: data.pools,
      });
    } else {
      console.warn(`No data returned for ${apiName}`);
    }
  }

  fs.writeFileSync(consolidatedFile, JSON.stringify(consolidatedData, null, 2));
  console.log(`Consolidated data saved to ${consolidatedFile}`);
}

// Run data fetching
(async () => {
  try {
    await fetchAllData();
  } catch (error) {
    console.error("Error during execution:", error.message);
  }
})();
