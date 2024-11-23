const fs = require('fs');

// Read historical data from JSON file
function readHistoricalData() {
  const filePath = 'historical-data.json';
  if (!fs.existsSync(filePath)) {
    console.error('No historical data file found.');
    return [];
  }
  const fileContent = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(fileContent);
}

// Analyze historical trends
function analyzeTrends() {
  const data = readHistoricalData();
  if (data.length === 0) {
    console.log('No data to analyze.');
    return;
  }

  const prices = data.map(entry => entry.ethPrice);
  const volumes = data.map(entry => entry.totalVolume);

  // Calculate average ETH price
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

  // Calculate percentage change in ETH price
  const priceChange = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;

  // Display results
  console.log('--- Historical Trend Analysis ---');
  console.log(`Average ETH Price: $${avgPrice.toFixed(2)}`);
  console.log(`Price Change: ${priceChange.toFixed(2)}%`);
  console.log(`Latest Total Volume: $${volumes[volumes.length - 1].toLocaleString()}`);
  console.log(`Number of Data Points: ${data.length}`);
}

// Run analysis
analyzeTrends();
