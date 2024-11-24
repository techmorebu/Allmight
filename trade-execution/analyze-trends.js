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

  return `
  - Average ETH Price: $${avgPrice.toFixed(2)}
  - Price Change: ${priceChange.toFixed(2)}%
  - Average Pool Volume: $${avgPoolVolume.toFixed(2)}
  - Average Pool Liquidity: $${avgLiquidity.toFixed(2)}
  `;
}

module.exports = { analyzeTrends };
