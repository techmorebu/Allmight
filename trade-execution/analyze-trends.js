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

  // Debug: Check if data exists
  console.log(`Total data entries found: ${data.length}`);
  if (data.length === 0) {
    console.log('No data to analyze.');
    return;
  }

  // Filter out invalid or missing pool data
  const validData = data.filter(entry => entry.topPool && !isNaN(entry.topPool.volumeUSD) && !isNaN(entry.topPool.liquidity));
  const invalidEntries = data.filter(entry => !entry.topPool || isNaN(entry.topPool.volumeUSD) || isNaN(entry.topPool.liquidity));

  // Debug: Log invalid entries
  if (invalidEntries.length > 0) {
    console.warn(`Invalid entries found: ${invalidEntries.length}`);
    console.warn('Examples of invalid entries:', invalidEntries.slice(0, 3)); // Log the first 3 invalid entries
  }

  if (validData.length === 0) {
    console.error('No valid data available for analysis.');
    return;
  }

  // Extract valid metrics
  const prices = validData.map(entry => entry.ethPrice);
  const volumes = validData.map(entry => entry.totalVolume);
  const poolVolumes = validData.map(entry => entry.topPool.volumeUSD);
  const poolLiquidity = validData.map(entry => entry.topPool.liquidity);

  // Compute averages with safeguards
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const priceChange = prices.length > 1 ? ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100 : 0;

  const avgPoolVolume = poolVolumes.length ? poolVolumes.reduce((a, b) => a + b, 0) / poolVolumes.length : 0;
  const avgLiquidity = poolLiquidity.length ? poolLiquidity.reduce((a, b) => a + b, 0) / poolLiquidity.length : 0;

  // Debug: Log computed metrics
  console.log('--- Computed Metrics ---');
  console.log(`Average ETH Price: $${avgPrice.toFixed(2)}`);
  console.log(`Price Change: ${priceChange.toFixed(2)}%`);
  console.log(`Average Pool Volume: $${avgPoolVolume.toFixed(2)}`);
  console.log(`Average Pool Liquidity: $${avgLiquidity.toFixed(2)}`);

  // Return results
  return {
    avgPrice,
    priceChange,
    avgPoolVolume,
    avgLiquidity,
  };
}

// Main execution block
function main() {
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

// Execute the script if run directly
if (require.main === module) {
  main();
}

module.exports = { analyzeTrends };
