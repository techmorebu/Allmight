const { ethers } = require('ethers');
const { fetchPoolDataLimited } = require('../modules/geckoTerminalData');
const { executeLiveTrade } = require('./trade-live');
require('dotenv').config();

async function simulateTrade() {
  console.log('--- Starting Trade Simulation ---');

  try {
    const poolData = await fetchPoolDataLimited('ETH/USDC');

    if (poolData.data && poolData.data.length > 0) {
      const pool = poolData.data[0];
      console.log('Fetched Pool Data:', pool);

      const signal = 'Buy'; // Example: Replace with actual signal logic
      const amount = 1; // Example: Replace with dynamic trade amount logic

      await executeLiveTrade(signal, amount);
    } else {
      console.log('No pool data found for the given token pair.');
    }
  } catch (error) {
    console.error('Error during trade simulation:', error.message);
  }
}

simulateTrade();
