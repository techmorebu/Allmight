const { analyzeTrends } = require('./analyze-trends');

// Generate trade signals based on analysis
function generateSignals(trends, marketIndicators) {
  const { avgPrice, priceChange, avgPoolVolume, avgLiquidity } = trends;
  const { rsi, sentiment, fearGreedIndex } = marketIndicators;

  const currentLiquidity = avgLiquidity * 0.9; // Simulated drop
  const currentVolume = avgPoolVolume * 1.5; // Simulated spike
  const stopLoss = avgPrice * 0.95; // 5% below average price
  const takeProfit = avgPrice * 1.05; // 5% above average price

  console.log('--- Trade Signal Logic ---');
  console.log(`RSI: ${rsi}`);
  console.log(`Current Liquidity: $${currentLiquidity.toFixed(2)}`);
  console.log(`Current Volume: $${currentVolume.toFixed(2)}`);
  console.log(`Sentiment: ${sentiment}`);
  console.log(`Fear & Greed Index: ${fearGreedIndex}`);
  console.log(`Stop Loss: $${stopLoss.toFixed(2)}`);
  console.log(`Take Profit: $${takeProfit.toFixed(2)}`);

  if (rsi < 30 && currentVolume > avgPoolVolume * 1.2 && sentiment > 0.5 && fearGreedIndex > 60) {
    console.log('💹 Buy Signal Triggered');
    return { signal: 'Buy', stopLoss, takeProfit };
  } else if (rsi > 70 && currentLiquidity < avgLiquidity * 0.8 && sentiment < -0.5 && fearGreedIndex < 40) {
    console.log('📉 Sell Signal Triggered');
    return { signal: 'Sell', stopLoss, takeProfit };
  } else {
    console.log('🤔 Hold Signal');
    return { signal: 'Hold', stopLoss, takeProfit };
  }
}

// Main function to execute signal generation
function main() {
  const trends = analyzeTrends();
  if (!trends) {
    console.error('No trends available to generate signals.');
    return;
  }

  // Example market indicators (replace with dynamic data)
  const marketIndicators = {
    rsi: 25, // Replace with real RSI calculation
    sentiment: 0.6, // Replace with fetched sentiment score
    fearGreedIndex: 70, // Replace with actual Fear & Greed index
  };

  const signal = generateSignals(trends, marketIndicators);
  console.log(`Final Signal:`, signal);
}

if (require.main === module) {
  main();
}

module.exports = { generateSignals };
