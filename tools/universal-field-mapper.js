const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const consolidatedFile = path.join(outputDir, "consolidated-fields.json");
const rawDataFile = path.join(outputDir, "raw-data.json");
const crossReferenceReport = path.join(outputDir, "cross-reference-report.json");
const requiredFields = ["price", "volume", "liquidity", "fees", "volatility", "RSI", "movingAverage", "correlation", "zScore", "spread"];
const TRANSACTION_THRESHOLD = 300;
const LIQUIDITY_THRESHOLD = 50000;

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
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

// Function to determine API type
function determineApiType(apiUrl) {
  if (apiUrl.includes("thegraph.com")) {
    return "GraphQL";
  } else {
    return "Unknown";
  }
}

// Fetch pool IDs dynamically
async function fetchPoolIds(apiUrl) {
  const query = `{
    pools(first: 100) {
      id
      txCount
      liquidity
    }
  }`;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch pool IDs: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data.pools || [];
  } catch (error) {
    console.error(`Error fetching pool IDs:`, error.message);
    return [];
  }
}

// Fetch pool data using dynamic queries
async function fetchPoolData(apiUrl, poolId) {
  const query = `{
    pool(id: "${poolId}") {
      id
      token0 {
        symbol
        priceUSD
      }
      token1 {
        symbol
        priceUSD
      }
      liquidity
      volumeUSD
      feesUSD
      txCount
      totalValueLockedUSD
      totalValueLockedToken0
      totalValueLockedToken1
      timestamp
    }
  }`;

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
    return data.data.pool;
  } catch (error) {
    console.error(`Error fetching pool data for ${poolId}:`, error.message);
    return null;
  }
}

// Filter pools based on transaction count OR liquidity thresholds
function filterPools(poolData) {
  return poolData.filter((pool) => {
    const txCount = parseInt(pool.txCount, 10) || 0;
    const liquidity = parseFloat(pool.liquidity) || 0;
    const include = txCount >= TRANSACTION_THRESHOLD || liquidity >= LIQUIDITY_THRESHOLD;
    console.log(`Pool ID: ${pool.id}, TxCount: ${txCount}, Liquidity: ${liquidity}, Included: ${include}`);
    return include;
  });
}

// Fetch and process data for each API
async function runMapper() {
  const consolidatedData = [];
  const rawData = [];

  for (const [apiName, apiUrl] of Object.entries(apis)) {
    console.log(`Processing API: ${apiName}`);

    const apiType = determineApiType(apiUrl);
    if (apiType !== "GraphQL") {
      console.log(`Skipping ${apiName}: Unsupported API type.`);
      continue;
    }

    // Dynamically fetch pool IDs
    const pools = await fetchPoolIds(apiUrl);
    const validPools = [];

    for (const pool of pools) {
      rawData.push(pool); // Save raw data for all pools
      const txCount = parseInt(pool.txCount, 10) || 0;
      const liquidity = parseFloat(pool.liquidity) || 0;
      if (txCount >= TRANSACTION_THRESHOLD || liquidity >= LIQUIDITY_THRESHOLD) {
        console.log(`Fetching detailed data for pool ID: ${pool.id}`);
        const detailedPoolData = await fetchPoolData(apiUrl, pool.id);
        if (detailedPoolData) {
          validPools.push(detailedPoolData);
        }
      }
    }

    consolidatedData.push({
      apiName,
      timestamp: new Date().toISOString(),
      pools: validPools,
    });

    console.log(`Filtered pools for ${apiName}:`, validPools);
  }

  // Save raw data output
  fs.writeFileSync(rawDataFile, JSON.stringify(rawData, null, 2));
  console.log(`Raw data saved to ${rawDataFile}`);

  // Save consolidated output
  fs.writeFileSync(consolidatedFile, JSON.stringify(consolidatedData, null, 2));
  console.log(`Consolidated output saved to ${consolidatedFile}`);
}

// Run the mapper
runMapper();
