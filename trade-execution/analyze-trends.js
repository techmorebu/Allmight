const fs = require('fs');

// Read historical data from logs
function readHistoricalData() {
  const filePath = '/home/techbu/OFA_Project_Local/ofa-project/logs/historical-data.json';
  if (!fs.existsSync(filePath)) {
    console.error('No historical data found.');
    return [];
  }
  const fileContent = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(fileContent);
}

// Analyze trends based on historical data
function analyzeTrends() {
  const data = readHistoricalData();

  console.log(`Total data entries found: ${data.length}`);
  if (data.length === 0) {
    console.log('No data to analyze.');
    return null;
  }

  // Filter valid entries
  const validData = data.filter(entry =>
    entry.topPool &&
    !isNaN(parseFloat(entry.topPool.volumeUSD)) &&
    !isNaN(parseFloat(entry.topPool.liquidity))
  );

  if (validData.length === 0) {
    console.error('No valid data available for analysis.');
    return null;
  }

  // Extract metrics from valid data
  const prices = validData.map(entry => entry.ethPrice);
  const poolVolumes = validData.map(entry => parseFloat(entry.topPool.volumeUSD));
  const poolLiquidity = validData.map(entry => parseFloat(entry.topPool.liquidity));

  // Compute averages and price change
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const priceChange = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;

  const avgPoolVolume = poolVolumes.reduce((a, b) => a + b, 0) / poolVolumes.length;
  const avgLiquidity = poolLiquidity.reduce((a, b) => a + b, 0) / poolLiquidity.length;

  console.log('--- Computed Metrics ---');
  console.log(`Average ETH Price: $${avgPrice.toFixed(2)}`);
  console.log(`Price Change: ${priceChange.toFixed(2)}%`);
  console.log(`Average Pool Volume: $${avgPoolVolume.toFixed(2)}`);
  console.log(`Average Pool Liquidity: $${avgLiquidity.toFixed(2)}`);

  // Return analysis results
  return {
    avgPrice,
    priceChange,
    avgPoolVolume,
    avgLiquidity,
  };
}

// Execute analysis if run directly
if (require.main === module) {
  console.log('--- Starting Trend Analysis ---');
  const trends = analyzeTrends();
  if (trends) {
    console.log('\n--- Final Summary ---');
    console.log(`Average ETH Price: $${trends.avgPrice.toFixed(2)}`);
    console.log(`Price Change: ${trends.priceChange.toFixed(2)}%`);
    console.log(`Average Pool Volume: $${trends.avgPoolVolume.toFixed(2)}`);
    console.log(`Average Pool Liquidity: $${trends.avgLiquidity.toFixed(2)}`);
  }
}

module.exports = { analyzeTrends };
