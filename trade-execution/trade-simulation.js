require('dotenv').config({ path: '../.env' });
const { analyzeTrends } = require('./analyze-trends');
const { generateSignals } = require('./signal-generator');
const { fetchPrices } = require('../modules/gmx-intergration');
const { logger } = require('../monitoring/logger');
const fs = require('fs');

async function simulateTrade(signal, trends, tokenPrices) {
  logger.info('Simulating trade execution...');
  const simulatedResults = {};

  for (const [token, trend] of Object.entries(trends)) {
    const entryPrice = tokenPrices[token]?.price || trend.price;
    const signalAction = signal[token]?.signal || 'Hold';
    let profit = 0;

    if (signalAction === 'Buy') {
      profit = entryPrice * 0.05; // Simulate 5% gain
    } else if (signalAction === 'Sell') {
      profit = entryPrice * -0.05; // Simulate 5% loss
    }

    simulatedResults[token] = {
      token,
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
  try {
    logger.info('--- Starting Trade Simulation ---');

    // Step 1: Load trends from file
    logger.info('Loading trends data...');
    let trends;
    try {
      const trendsData = fs.readFileSync('./logs/trends-log.json', 'utf8');
      trends = JSON.parse(trendsData);
      logger.info('Trends data loaded successfully.');
    } catch (error) {
      throw new Error(`Failed to load trends data: ${error.message}`);
    }

    if (!trends || Object.keys(trends).length === 0) {
      throw new Error('No trends available for simulation.');
    }

    // Step 2: Fetch GMX price data
    const tokenPrices = await fetchPrices('ARBITRUM'); // Example network
    if (!tokenPrices || Object.keys(tokenPrices).length === 0) {
      logger.warn('No GMX price data fetched. Using trends data for simulation.');
    } else {
      logger.info('Fetched GMX Price Data:', JSON.stringify(tokenPrices, null, 2));
    }

    // Step 3: Generate signals
    const signals = generateSignals(trends);
    if (!signals || Object.keys(signals).length === 0) {
      throw new Error('No signals generated for simulation.');
    }
    logger.info('Generated Signals:', JSON.stringify(signals, null, 2));

    // Step 4: Simulate trades
    const simulationResults = await simulateTrade(signals, trends, tokenPrices || trends);

    // Step 5: Calculate and log summary
    const totalTrades = Object.keys(simulationResults).length;
    const wins = Object.values(simulationResults).filter((r) => r.profit > 0).length;
    const losses = totalTrades - wins;
    const totalProfit = Object.values(simulationResults).reduce((sum, r) => sum + r.profit, 0);
    const winLossRatio = (wins / (losses || 1)).toFixed(2); // Avoid division by zero
    const averageProfit = (totalProfit / totalTrades).toFixed(2);

    const backtestSummary = {
      totalTrades,
      wins,
      losses,
      winLossRatio,
      totalProfit: totalProfit.toFixed(2),
      averageProfit,
    };

    logger.info('--- Backtest Summary ---');
    logger.info(JSON.stringify(backtestSummary, null, 2));

    // Step 6: Save results
    const logPath = './logs/backtest-results.log';
    const logData = `Backtest Results - ${new Date().toISOString()}\n${JSON.stringify(
      simulationResults,
      null,
      2
    )}\nSummary: ${JSON.stringify(backtestSummary, null, 2)}\n\n`;

    fs.appendFileSync(logPath, logData, 'utf8');
    logger.info(`Backtest results saved to ${logPath}`);
  } catch (error) {
    logger.error(`Error during trade simulation: ${error.message}`);
  }
}

// Execute the script if run directly
if (require.main === module) {
  tradeSimulation();
}

module.exports = { tradeSimulation };
