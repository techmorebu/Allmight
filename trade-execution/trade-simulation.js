require('dotenv').config();
const fs = require('fs');
const { generateSignals } = require('./signal-generator');
const { analyzeTrends } = require('./analyze-trends');
const { logger } = require('../monitoring/logger');

// Simulate trade execution based on signals
function simulateTrade(signal, trends) {
  logger.info('Simulating trade execution...');
  const profit = signal.signal === 'Buy' ? trends.avgPrice * 0.05 : -trends.avgPrice * 0.05; // Example logic
  return {
    signal: signal.signal,
    profit,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
  };
}

// Main Function
async function main() {
  logger.info('--- Starting Trade Simulation ---');

  // Read processed data from pipeline
  const trendsPath = './logs/trends-log.json';
  if (!fs.existsSync(trendsPath)) {
    logger.error('No processed trends data found. Ensure the pipeline has run.');
    return;
  }

  const trendsData = JSON.parse(fs.readFileSync(trendsPath, 'utf8'));

  // Analyze trends and generate signals
  const trends = analyzeTrends(trendsData);
  if (!trends) {
    logger.error('No trends available for analysis.');
    return;
  }

  const signal = generateSignals(trends);
  if (!signal) {
    logger.error('No signal generated.');
    return;
  }

  logger.info(`Generated Signal: ${JSON.stringify(signal)}`);

  // Simulate the trade
  const simulatedResult = simulateTrade(signal, trends);
  logger.info(`Simulated Trade Result: ${JSON.stringify(simulatedResult)}`);
}

// Run the simulation
if (require.main === module) {
  main().catch((error) => {
    logger.error(`Error during trade simulation: ${error.message}`);
  });
}
