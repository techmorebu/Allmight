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

// Analyze trends
function analyzeTrends() {
  const data = readHistoricalData();
  if (data.length === 0) {
    console.log('No data to analyze.');
    return;
  }

  const prices = data.map(entry => entry.ethPrice);
  const volumes = data.map(entry => entry.totalVolume);
  const poolVolumes = data.map(entry => entry.topPool?.volumeUSD || 0);
  const poolLiquidity = data.map(entry => entry.topPool?.liquidity || 0);

  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const priceChange = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;

  const avgPoolVolume = poolVolumes.reduce((a, b) => a + b, 0) / poolVolumes.length;
  const avgLiquidity = poolLiquidity.reduce((a, b) => a + b, 0) / poolLiquidity.length;

  console.log('--- Historical Trend Analysis ---');
  console.log(`Average ETH Price: $${avgPrice.toFixed(2)}`);
  console.log(`Price Change: ${priceChange.toFixed(2)}%`);
  console.log(`Average Pool Volume: $${avgPoolVolume.toFixed(2)}`);
  console.log(`Average Pool Liquidity: $${avgLiquidity.toFixed(2)}`);

  return {
    avgPrice,
    priceChange,
    avgPoolVolume,
    avgLiquidity,
  };
}

// Main execution block
function main() {
  console.log('Starting trend analysis...');
  const trends = analyzeTrends();
  if (trends) {
    console.log('\n--- Final Summary ---');
    console.log(`Average ETH Price: $${trends.avgPrice.toFixed(2)}`);
    console.log(`Price Change: ${trends.priceChange.toFixed(2)}%`);
    console.log(`Average Pool Volume: $${trends.avgPoolVolume.toFixed(2)}`);
    console.log(`Average Pool Liquidity: $${trends.avgLiquidity.toFixed(2)}`);
  }
}

// Execute the script if run directly
if (require.main === module) {
  main();
}

module.exports = { analyzeTrends };
