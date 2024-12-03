const fs = require('fs');
const path = require('path');
const { analyzeTrends } = require('../trade-execution/analyze-trends');
const { generateSignals } = require('../trade-execution/signal-generator');

// Initialize metrics
let totalTrades = 0;
let wins = 0;
let losses = 0;
let cumulativePnL = 0;
const tradeDurations = []; // Array to track trade durations

function backtest() {
  console.log('--- Starting Backtest ---');
  const results = [];

  try {
    const trends = analyzeTrends();
    if (!trends) {
      console.error('No trends available for backtesting.');
      return null;
    }

    console.log('Analyzed Trends:', trends);

    const signal = generateSignals(trends);
    console.log('Generated Signal:', signal);

    // Simulate trade execution
    const simulatedResult = simulateTrade(signal, trends);
    console.log('Simulated Trade Result:', simulatedResult);

    if (simulatedResult) {
      results.push(simulatedResult);
    }

    return results;
  } catch (error) {
    console.error('Error during backtest:', error.message);
    return null;
  }
}

function simulateTrade(signal, trends) {
  try {
    const tradeStartTime = new Date(); // Simulated trade start time

    // Simulate profit/loss (P&L)
    const profit =
      signal.signal === 'Buy' ? trends.avgPrice * 0.05 : -trends.avgPrice * 0.05;

    // Track metrics
    totalTrades++;
    if (profit > 0) {
      wins++;
    } else {
      losses++;
    }
    cumulativePnL += profit;

    // Simulate trade end time (example: trade takes 1 hour)
    const tradeEndTime = new Date(tradeStartTime.getTime() + 60 * 60 * 1000);
    const tradeDuration = (tradeEndTime - tradeStartTime) / (60 * 1000); // Duration in minutes
    tradeDurations.push(tradeDuration);

    return {
      signal: signal.signal,
      profit,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      tradeDuration,
    };
  } catch (error) {
    console.error('Error during trade simulation:', error.message);
    return null;
  }
}

function calculateMetrics() {
  const winLossRatio = wins / (losses || 1);
  const avgTradeDuration =
    tradeDurations.reduce((sum, duration) => sum + duration, 0) /
    (tradeDurations.length || 1);

  return {
    totalTrades,
    wins,
    losses,
    winLossRatio,
    cumulativePnL,
    avgTradeDuration,
  };
}

function logResults(results, metrics) {
  const logDir = path.join(__dirname, '../logs');
  const logPath = path.join(logDir, 'backtest-results.log');

  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      console.log('Logs directory created:', logDir);
    }

    const logData = `Backtest Results - ${new Date().toISOString()}\nResults:\n${JSON.stringify(
      results,
      null,
      2
    )}\nMetrics:\n${JSON.stringify(metrics, null, 2)}\n\n`;
    fs.appendFileSync(logPath, logData, 'utf8');
    console.log('Backtest results saved to logs/backtest-results.log');
  } catch (error) {
    console.error('Error logging backtest results:', error.message);
  }
}

// Main Execution
if (require.main === module) {
  const results = backtest();
  const metrics = calculateMetrics();
  if (results) logResults(results, metrics);

  // Display metrics in console
  console.log('--- Backtest Summary ---');
  console.log(`Total Trades: ${metrics.totalTrades}`);
  console.log(`Wins: ${metrics.wins}`);
  console.log(`Losses: ${metrics.losses}`);
  console.log(`Win/Loss Ratio: ${metrics.winLossRatio.toFixed(2)}`);
  console.log(`Cumulative P&L: ${metrics.cumulativePnL.toFixed(2)} USD`);
  console.log(`Average Trade Duration: ${metrics.avgTradeDuration.toFixed(2)} minutes`);
}
