const { generateSignals } = require('./signal-generator');
const fs = require('fs');

// Log trade results to a file
function logTradeResult(signal, amount) {
  const filePath = '/home/techbu/OFA_Project_Local/ofa-project/logs/trade-log.json';
  const trade = {
    timestamp: new Date().toISOString(),
    signal,
    amount,
  };

  let existingTrades = [];
  try {
    // Read existing trades if the file exists
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      existingTrades = JSON.parse(fileContent);
    }

    // Add the new trade to the log
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

  // Log the trade result
  logTradeResult(signal, amount);
}

// Main function to generate signal and execute simulation
function main() {
  console.log('--- Starting Trade Simulation ---');
  const trends = {
    avgPrice: 3000, // Replace with dynamic data
    priceChange: 2,
    avgPoolVolume: 5000000,
    avgLiquidity: 20000000,
  };

  // Generate signal based on trends
  const signal = generateSignals(trends);

  // Simulate a trade
  simulateTrade(signal);
}

// Execute if the script is run directly
if (require.main === module) {
  main();
}

module.exports = { simulateTrade, logTradeResult };
