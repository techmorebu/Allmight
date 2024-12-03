require('dotenv').config({ path: '../.env' });
const { analyzeTrends } = require('./analyze-trends');
const { generateSignals } = require('./signal-generator');
const { fetchPrices } = require('../modules/gmxIntegration');
const { logger } = require('../monitoring/logger');

async function simulateTrade(signal, trends, tokenPrices) {
  logger.info('Simulating trade execution...');
  const simulatedResults = {};

  for (const [token, data] of Object.entries(trends)) {
    const entryPrice = tokenPrices[token]?.price || data.price;
    const signalAction = signal[token]?.signal || 'Hold';
    let profit = 0;

    if (signalAction === 'Buy') {
      profit = entryPrice * 0.05; // Assume 5% profit
    } else if (signalAction === 'Sell') {
      profit = entryPrice * -0.05; // Assume 5% loss
    }

    simulatedResults[token] = {
      signal: signalAction,
      entryPrice,
      profit,
      timestamp: new Date().toISOString(),
    };

    logger.info(`Simulated trade for ${token}: ${JSON.stringify(simulatedResults[token], null, 2)}`);
  }

  return simulatedResults;
}

async function tradeSimulation() {
  logger.info('--- Starting Trade Simulation ---');

  // Step 1: Analyze trends
  logger.info('Starting trend analysis...');
  const trends = analyzeTrends();
  if (!trends || Object.keys(trends).length === 0) {
    logger.error('No trends available for simulation.');
    return;
  }

  // Step 2: Fetch GMX price data for enhanced simulation
  logger.info('Fetching GMX price data...');
  const tokenPrices = await fetchPrices('ARBITRUM'); // Example network
  if (!tokenPrices || Object.keys(tokenPrices).length === 0) {
    logger.warn('No GMX price data fetched. Using trends for simulation.');
  } else {
    logger.info('GMX Price Data:', tokenPrices);
  }

  // Step 3: Generate signals
  logger.info('Generating trading signals...');
  const signal = generateSignals(trends);
  logger.info('Generated Signals:', signal);

  // Step 4: Simulate trade execution
  const simulationResults = await simulateTrade(signal, trends, tokenPrices || trends);

  // Step 5: Log and summarize results
  const totalTrades = Object.keys(simulationResults).length;
  const wins = Object.values(simulationResults).filter((r) => r.profit > 0).length;
  const losses = totalTrades - wins;
  const totalProfit = Object.values(simulationResults).reduce((sum, r) => sum + r.profit, 0);
  const winLossRatio = wins / (losses || 1); // Avoid division by zero
  const averageProfit = totalProfit / totalTrades;

  const backtestSummary = {
    totalTrades,
    wins,
    losses,
    winLossRatio: winLossRatio.toFixed(2),
    totalProfit: totalProfit.toFixed(2),
    averageProfit: averageProfit.toFixed(2),
  };

  logger.info('--- Backtest Summary ---');
  logger.info(JSON.stringify(backtestSummary, null, 2));

  const logPath = './logs/backtest-results.log';
  const logData = `Backtest Results - ${new Date().toISOString()}\n${JSON.stringify(
    simulationResults,
    null,
    2
  )}\nSummary: ${JSON.stringify(backtestSummary, null, 2)}\n\n`;

  require('fs').appendFileSync(logPath, logData, 'utf8');
  logger.info(`Backtest results saved to ${logPath}`);
}

// Execute the script if run directly
if (require.main === module) {
  tradeSimulation();
}

module.exports = { tradeSimulation };
