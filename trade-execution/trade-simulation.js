const { ethers } = require('ethers');
const { fetchPoolDataLimited } = require('../modules/geckoTerminalData'); // GeckoTerminal API module
const { executeLiveTrade } = require('./trade-live'); // Existing live trading function
require('dotenv').config({ path: '/home/techbu/OFA_Project_Local/ofa-project/.env' });

async function simulateTrade() {
  console.log('--- Starting Trade Simulation ---');

  try {
    // Initialize Ethereum provider
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);

    // Fetch pool data for the token pair (example: ETH/USDC) using GeckoTerminal API
    console.log('Fetching pool data from GeckoTerminal API...');
    const poolData = await fetchPoolDataLimited('ETH/USDC'); // Replace 'ETH/USDC' with dynamic pair as needed

    if (poolData.data && poolData.data.length > 0) {
      const pool = poolData.data[0]; // Use the first pool in the response
      console.log('Fetched Pool Data:', pool);

      // Extract useful information
      const { volume_usd, token_0, token_1, liquidity_usd } = pool.attributes;

      console.log('Pool Summary:');
      console.log(`Token Pair: ${token_0.symbol}/${token_1.symbol}`);
      console.log(`Volume (USD): $${volume_usd}`);
      console.log(`Liquidity (USD): $${liquidity_usd}`);

      // Define trade signal based on analysis (example: Buy if volume exceeds $1M)
      const signal = volume_usd > 1000000 ? 'Buy' : 'Hold';

      if (signal === 'Buy') {
        console.log(`Trade Signal: ${signal}`);
        console.log(`Executing trade to purchase ${token_1.symbol}...`);
        await executeLiveTrade(signal, 1); // Example: Buy 1 ETH
      } else {
        console.log(`Trade Signal: ${signal}. No trade executed.`);
      }
    } else {
      console.log('No pool data found for the given token pair.');
    }
  } catch (error) {
    console.error('Error during trade simulation:', error.message);
  }
}

simulateTrade();
