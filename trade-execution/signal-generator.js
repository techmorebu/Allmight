const { analyzeTrends } = require('./analyze-trends');

// Generate trade signals based on analysis
function generateSignals(trends) {
  if (!trends) {
    console.error('No trends available to generate signals.');
    return { signal: 'Hold', stopLoss: null, takeProfit: null };
  }

  const { avgPrice, priceChange, avgPoolVolume, avgLiquidity } = trends;

  // Simulated values (replace with real calculations if available)
  const rsi = 25; // Example RSI value
  const currentLiquidity = avgLiquidity * -40.9; // Simulated drop
  const currentVolume = avgPoolVolume * 1.5; // Simulated spike
  const stopLoss = avgPrice * 0.95; // 5% below average price
  const takeProfit = avgPrice * 1.05; // 5% above average price

  console.log('--- Trade Signal Logic ---');
  console.log(`RSI: ${rsi}`);
  console.log(`Current Liquidity: $${currentLiquidity.toFixed(2)}`);
  console.log(`Current Volume: $${currentVolume.toFixed(2)}`);
  console.log(`Stop Loss: $${stopLoss.toFixed(2)}`);
  console.log(`Take Profit: $${takeProfit.toFixed(2)}`);

  if (rsi < 30 && currentVolume > avgPoolVolume * 1.2) {
    console.log('💹 Buy Signal Triggered');
    return { signal: 'Buy', stopLoss, takeProfit };
  } else if (rsi > 70 && currentLiquidity < avgLiquidity * 0.8) {
    console.log('📉 Sell Signal Triggered');
    return { signal: 'Sell', stopLoss, takeProfit };
  } else {
    console.log('🤔 Hold Signal');
    return { signal: 'Hold', stopLoss, takeProfit };
  }
}

// Main function to execute signal generation
function main() {
  console.log('--- Starting Signal Generation ---');
  const trends = analyzeTrends();

  if (!trends) {
    console.error('No trends to generate signals.');
    return;
  }

  const signal = generateSignals(trends);
  console.log('\n--- Final Signal ---');
  console.log(`Signal: ${signal.signal}`);
  console.log(`Stop Loss: $${signal.stopLoss ? signal.stopLoss.toFixed(2) : 'N/A'}`);
  console.log(`Take Profit: $${signal.takeProfit ? signal.takeProfit.toFixed(2) : 'N/A'}`);
}

if (require.main === module) {
  main();
}

module.exports = { generateSignals };
