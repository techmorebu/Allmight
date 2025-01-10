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

// Detect WebSocket compatibility for APIs
const detectWebSocketSupport = async (apiUrl) => {
  try {
    console.log(`Checking WebSocket compatibility for ${apiUrl}...`);
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch API metadata from ${apiUrl}: ${response.statusText}`);
    }
    const data = await response.json();

    // Check if WebSocket support is mentioned in the API metadata
    if (data.webSocketEndpoints) {
      return data.webSocketEndpoints;
    }
    return null;
  } catch (error) {
    console.error(`Error detecting WebSocket compatibility for ${apiUrl}:`, error.message);
    return null;
  }
};

// WebSocket Handlers
const initializeWebSocket = (url, onMessage) => {
  const ws = new WebSocket(url);

  ws.on("open", () => {
    console.log(`Connected to WebSocket: ${url}`);
  });

  ws.on("message", (data) => {
    const parsedData = JSON.parse(data);
    onMessage(parsedData);
  });

  ws.on("error", (err) => {
    console.error(`WebSocket error on ${url}:`, err);
  });

  ws.on("close", () => {
    console.log(`WebSocket connection closed: ${url}`);
    setTimeout(() => initializeWebSocket(url, onMessage), 5000); // Reconnect
  });

  return ws;
};

// REST API Fetching
const fetchApiData = async (apiName, apiUrl) => {
  try {
    console.log(`Fetching data from ${apiName} (${apiUrl})...`);
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch data from ${apiName}: ${response.statusText}`);
    }
    const data = await response.json();
    await redis.set(apiName, JSON.stringify(data), "EX", 10); // Cache data for 10 seconds
    return data;
  } catch (error) {
    console.error(`Error fetching data from ${apiName}:`, error.message);
    return null;
  }
};

// Data Aggregation and Normalization
const normalizeData = (apiName, data) => {
  // Example normalization logic
  return data.map((item) => ({
    apiName,
    price: item.price || item.tokenPrice || item.outputTokenPriceUSD || null,
    liquidity: item.totalLiquidity || item.poolLiquidity || null,
    volume: item.dailyVolumeUSD || item.cumulativeVolumeUSD || null,
    fee: item.swapFee || item.protocolFee || null,
    timestamp: new Date().toISOString(),
  }));
};

// Main Data Fetching Loop
const runDataFetchingPipeline = async () => {
  for (const [apiName, apiUrl] of Object.entries(apis)) {
    const webSocketEndpoints = await detectWebSocketSupport(apiUrl);
    if (webSocketEndpoints) {
      console.log(`WebSocket support detected for ${apiName}:`, webSocketEndpoints);
      webSocketEndpoints.forEach((wsUrl) => {
        initializeWebSocket(wsUrl, (data) => {
          console.log(`Real-time data from ${apiName}:`, data);
          redis.set(`${apiName}-realtime`, JSON.stringify(data), "EX", 5);
        });
      });
    } else {
      const data = await fetchApiData(apiName, apiUrl);
      if (data) {
        const normalizedData = normalizeData(apiName, data);
        const outputPath = path.join(outputDir, `${apiName}-normalized.json`);
        fs.writeFileSync(outputPath, JSON.stringify(normalizedData, null, 2));
        console.log(`Normalized data saved to ${outputPath}`);
      }
    }
  }
  console.log("Data fetching pipeline completed.");
};

// Run Pipeline
runDataFetchingPipeline();
setInterval(runDataFetchingPipeline, 10000); // Poll every 10 seconds
