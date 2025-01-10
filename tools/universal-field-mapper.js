const fetch = require("node-fetch");
const WebSocket = require("ws");
const Redis = require("ioredis");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const outputDir = path.join(__dirname, "../outputs");
const redis = new Redis(); // In-memory caching with Redis

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// GMX and DYDX Endpoints
const gmxEndpoints = {
  arbitrum: {
    tickers: process.env.GMX_ARBITRUM_TICKERS_URL,
    signedPrices: process.env.GMX_ARBITRUM_SIGNED_PRICES_URL,
    candles: process.env.GMX_ARBITRUM_CANDLES_URL,
    tokens: process.env.GMX_ARBITRUM_TOKENS_URL,
  },
  avalanche: {
    tickers: process.env.GMX_AVALANCHE_TICKERS_URL,
    signedPrices: process.env.GMX_AVALANCHE_SIGNED_PRICES_URL,
    candles: process.env.GMX_AVALANCHE_CANDLES_URL,
    tokens: process.env.GMX_AVALANCHE_TOKENS_URL,
  },
};

const dydxWebSocketUrl = process.env.DYDX_WEBSOCKET_URL;

const dexEndpoints = {
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

// Fetch GMX Data
async function fetchGmxData(apiName, url) {
  try {
    console.log(`Fetching GMX data: ${apiName}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch GMX data from ${url}: ${response.statusText}`);
    }
    const data = await response.json();
    await redis.set(apiName, JSON.stringify(data), "EX", 10); // Cache data for 10 seconds
    return data;
  } catch (error) {
    console.error(`Error fetching GMX data (${apiName}):`, error.message);
    return null;
  }
}

// Fetch DEX Data
async function fetchDexData(apiName, url) {
  try {
    console.log(`Fetching DEX data: ${apiName}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch DEX data from ${url}: ${response.statusText}`);
    }
    const data = await response.json();
    await redis.set(apiName, JSON.stringify(data), "EX", 10); // Cache data for 10 seconds
    return data;
  } catch (error) {
    console.error(`Error fetching DEX data (${apiName}):`, error.message);
    return null;
  }
}

// Initialize DYDX WebSocket
function initializeDydxWebSocket() {
  const ws = new WebSocket(dydxWebSocketUrl);

  ws.on("open", () => {
    console.log("Connected to DYDX WebSocket.");
    ws.send(
      JSON.stringify({
        type: "subscribe",
        channel: "v3_orderbook", // Example subscription, adjust as needed
        id: "BTC-USD",
      })
    );
  });

  ws.on("message", (data) => {
    const parsedData = JSON.parse(data);
    console.log("DYDX Real-Time Data:", parsedData);
    redis.set("dydx-realtime", JSON.stringify(parsedData), "EX", 5);
  });

  ws.on("error", (err) => {
    console.error("DYDX WebSocket error:", err.message);
  });

  ws.on("close", () => {
    console.log("DYDX WebSocket closed. Reconnecting...");
    setTimeout(initializeDydxWebSocket, 5000); // Reconnect after 5 seconds
  });
}

// Consolidated Report
function generateConsolidatedReport() {
  const consolidatedData = [];

  for (const [apiName, url] of Object.entries(dexEndpoints)) {
    consolidatedData.push({
      apiName,
      url,
      type: "DEX",
    });
  }

  for (const [network, endpoints] of Object.entries(gmxEndpoints)) {
    for (const [endpointName, url] of Object.entries(endpoints)) {
      consolidatedData.push({
        apiName: `${network}-${endpointName}`,
        url,
        type: "GMX",
      });
    }
  }

  consolidatedData.push({
    apiName: "DYDX",
    url: dydxWebSocketUrl,
    type: "WebSocket",
  });

  const reportPath = path.join(outputDir, "consolidated-endpoints.json");
  fs.writeFileSync(reportPath, JSON.stringify(consolidatedData, null, 2));
  console.log(`Consolidated report saved to ${reportPath}`);
}

// Main Data Fetching Pipeline
async function runDataFetchingPipeline() {
  // Fetch GMX Data
  for (const [network, endpoints] of Object.entries(gmxEndpoints)) {
    for (const [endpointName, url] of Object.entries(endpoints)) {
      if (url) {
        const data = await fetchGmxData(`${network}-${endpointName}`, url);
        if (data) {
          const outputPath = path.join(outputDir, `${network}-${endpointName}.json`);
          fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
          console.log(`GMX ${network} ${endpointName} data saved to ${outputPath}`);
        }
      }
    }
  }

  // Fetch DEX Data
  for (const [apiName, url] of Object.entries(dexEndpoints)) {
    if (url) {
      const data = await fetchDexData(apiName, url);
      if (data) {
        const outputPath = path.join(outputDir, `${apiName}-data.json`);
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
        console.log(`DEX ${apiName} data saved to ${outputPath}`);
      }
    }
  }

  console.log("Data fetching pipeline completed.");
  generateConsolidatedReport();
}

// Initialize WebSocket and Fetch Pipeline
initializeDydxWebSocket();
runDataFetchingPipeline();
setInterval(runDataFetchingPipeline, 10000); // Poll every 10 seconds
