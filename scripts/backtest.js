const { analyzeTrends } = require('../trade-execution/analyze-trends');
const { generateSignals } = require('../trade-execution/signal-generator');
const fs = require('fs');

// Read historical data
function readHistoricalData() {
  const filePath = '/home/techbu/OFA_Project_Local/ofa-project/logs/historical-data.json';
  if (!fs.existsSync(filePath)) {
    console.error('No historical data found.');
    return [];
  }
  const fileContent = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(fileContent);
}

// Simulate trades based on historical data
function backtest() {
  console.log('--- Starting Backtesting ---');

  const historicalData = readHistoricalData();

  if (!historicalData || historicalData.length === 0) {
    console.error('No historical data available for backtesting.');
    return;
  }

  let wins = 0;
  let losses = 0;
  let totalProfit = 0;
  let totalLoss = 0;

  console.log(`Total historical entries: ${historicalData.length}`);

  historicalData.forEach((dataPoint, index) => {
    // Analyze trends for the current data point
    const trends = analyzeTrends([dataPoint]); // Pass a single entry as an array

    if (!trends) {
      console.log(`Skipping entry ${index + 1}: Invalid trends.`);
      return;
    }

    // Generate signal
    const { signal, stopLoss, takeProfit } = generateSignals(trends);

    // Simulate trade
    const entryPrice = dataPoint.ethPrice;
    let exitPrice = entryPrice;

    // Mock price movement
    if (signal === 'Buy') {
      exitPrice = Math.min(takeProfit, entryPrice * 1.02); // Simulate upward price movement
    } else if (signal === 'Sell') {
      exitPrice = Math.max(stopLoss, entryPrice * 0.98); // Simulate downward price movement
    }

    // Evaluate trade outcome
    const profitOrLoss = exitPrice - entryPrice;
    if (profitOrLoss > 0) {
      wins++;
      totalProfit += profitOrLoss;
    } else {
      losses++;
      totalLoss += Math.abs(profitOrLoss);
    }

    console.log(`Trade ${index + 1}: ${signal}`);
    console.log(`Entry Price: $${entryPrice.toFixed(2)}`);
    console.log(`Exit Price: $${exitPrice.toFixed(2)}`);
    console.log(`Profit/Loss: $${profitOrLoss.toFixed(2)}`);
  });

  // Calculate performance metrics
  const totalTrades = wins + losses;
  const winRate = (wins / totalTrades) * 100;
  const riskRewardRatio = totalProfit / (totalLoss || 1); // Avoid division by zero
  const sharpeRatio = totalProfit / totalTrades; // Simplified Sharpe ratio

  console.log('--- Backtesting Results ---');
  console.log(`Total Trades: ${totalTrades}`);
  console.log(`Wins: ${wins}`);
  console.log(`Losses: ${losses}`);
  console.log(`Win Rate: ${winRate.toFixed(2)}%`);
  console.log(`Total Profit: $${totalProfit.toFixed(2)}`);
  console.log(`Total Loss: $${totalLoss.toFixed(2)}`);
  console.log(`Risk-Reward Ratio: ${riskRewardRatio.toFixed(2)}`);
  console.log(`Sharpe Ratio: ${sharpeRatio.toFixed(2)}`);
}

// Execute the script if run directly
if (require.main === module) {
  backtest();
}

module.exports = { backtest };
