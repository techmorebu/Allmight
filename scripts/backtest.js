const fs = require('fs');
const path = require('path');
const { analyzeTrends } = require('../trade-execution/analyze-trends');
const { generateSignals } = require('../trade-execution/signal-generator');

function backtest() {
  console.log('--- Starting Backtest ---');

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

    return {
      trends,
      signal,
      simulatedResult,
    };
  } catch (error) {
    console.error('Error during backtest:', error.message);
    return null;
  }
}

function simulateTrade(signal, trends) {
  try {
    const profit = signal.signal === 'Buy' ? trends.avgPrice * 0.05 : -trends.avgPrice * 0.05; // Example logic
    return {
      signal: signal.signal,
      profit,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
    };
  } catch (error) {
    console.error('Error during trade simulation:', error.message);
    return null;
  }
}

function logResults(results) {
  const logDir = path.join(__dirname, '../logs');
  const logPath = path.join(logDir, 'backtest-results.log');

  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      console.log('Logs directory created:', logDir);
    }

    const logData = `Backtest Results - ${new Date().toISOString()}\n${JSON.stringify(results, null, 2)}\n\n`;
    fs.appendFileSync(logPath, logData, 'utf8');
    console.log('Backtest results saved to logs/backtest-results.log');
  } catch (error) {
    console.error('Error logging backtest results:', error.message);
  }
}

// Main Execution
if (require.main === module) {
  const results = backtest();
  if (results) logResults(results);
}
