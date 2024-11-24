const { generateSignals } = require('./signal-generator');
const fs = require('fs');
require('dotenv').config({ path: '/home/techbu/OFA_Project_Local/ofa-project/.env' });

const LIVE_FIRE = process.env.LIVE_FIRE === 'true';

// Log trade results to a file
function logTradeResult(signal, amount, priceAtSignal) {
  const filePath = '/home/techbu/OFA_Project_Local/ofa-project/logs/trade-log.json';
  const trade = {
    timestamp: new Date().toISOString(),
    signal,
    amount,
    priceAtSignal,
  };

  let existingTrades = [];
  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      existingTrades = JSON.parse(fileContent);
    }

    existingTrades.push(trade);
    fs.writeFileSync(filePath, JSON.stringify(existingTrades, null, 2));
    console.log('Trade logged:', trade);
  } catch (error) {
    console.error('Error logging trade:', error.message);
  }
}

// Simulate trade execution
function simulateTrade(signal, amount = 1) {
  console.log('--- Simulated Trade Execution ---');
  if (signal === 'Buy') {
    console.log(`Buying ${amount} ETH`);
  } else if (signal === 'Sell') {
    console.log(`Selling ${amount} ETH`);
  } else {
    console.log('Holding position. No trade executed.');
  }
  logTradeResult(signal, amount, 3422); // Example ETH price at signal
}

// Execute a live trade (placeholder logic)
async function executeLiveTrade(signal, amount = 1) {
  console.log('--- Live Trade Execution ---');
  if (signal === 'Buy') {
    console.log(`Executing live buy of ${amount} ETH.`);
  } else if (signal === 'Sell') {
    console.log(`Executing live sell of ${amount} ETH.`);
  } else {
    console.log('Holding position. No trade executed.');
  }
  logTradeResult(signal, amount, 3422); // Replace with real price from API
}

function main() {
  console.log(`--- Starting Trade Execution (${LIVE_FIRE ? 'LIVE' : 'SIMULATION'} MODE) ---`);
  const trends = {
    avgPrice: 3000, // Replace with dynamic data
    priceChange: 2,
    avgPoolVolume: 5000000,
    avgLiquidity: 20000000,
  };

  // Generate signal
  const signal = generateSignals(trends);

  if (LIVE_FIRE) {
    executeLiveTrade(signal.signal, 1); // Replace with dynamic amount
  } else {
    simulateTrade(signal.signal, 1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { simulateTrade, executeLiveTrade };
