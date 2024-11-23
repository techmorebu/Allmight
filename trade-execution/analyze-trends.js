const fs = require('fs');

// Read historical data
function readHistoricalData() {
  const filePath = 'historical-data.json';
  if (!fs.existsSync(filePath)) {
    console.error('No historical data found.');
    return [];
  }
  const fileContent = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(fileContent);
}

// Analyze trends and return as a string
function analyzeTrends() {
  const data = readHistoricalData();
  if (data.length === 0) {
    return 'No data available for trend analysis.';
  }

  const prices = data.map(entry => entry.ethPrice);
  const volumes = data.map(entry => entry.totalVolume);

  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const priceChange = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  const volumeChange = ((volumes[volumes.length - 1] - volumes[0]) / volumes[0]) * 100;

  return `
  - Average ETH Price: $${avgPrice.toFixed(2)}
  - Price Change: ${priceChange.toFixed(2)}%
  - Highest ETH Price: $${maxPrice.toFixed(2)}
  - Lowest ETH Price: $${minPrice.toFixed(2)}
  - Volume Change: ${volumeChange.toFixed(2)}%
  `;
}

module.exports = { analyzeTrends };
