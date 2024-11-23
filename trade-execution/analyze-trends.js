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

// Analyze trends and calculate metrics
function analyzeTrends() {
  const data = readHistoricalData();
  if (data.length === 0) {
    console.log('No data to analyze.');
    return;
  }

  const prices = data.map(entry => entry.ethPrice);
  const volumes = data.map(entry => entry.totalVolume);

  // Calculate key metrics
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const priceChange = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  const volumeChange = ((volumes[volumes.length - 1] - volumes[0]) / volumes[0]) * 100;

  // Calculate volatility (standard deviation)
  const priceMean = avgPrice;
  const priceVariance = prices.reduce((acc, p) => acc + Math.pow(p - priceMean, 2), 0) / prices.length;
  const priceStdDev = Math.sqrt(priceVariance);

  // Display metrics
  console.log('--- Historical Trend Analysis ---');
  console.log(`Average ETH Price: $${avgPrice.toFixed(2)}`);
  console.log(`Price Change: ${priceChange.toFixed(2)}%`);
  console.log(`Highest ETH Price: $${maxPrice.toFixed(2)}`);
  console.log(`Lowest ETH Price: $${minPrice.toFixed(2)}`);
  console.log(`Price Volatility (Std Dev): $${priceStdDev.toFixed(2)}`);
  console.log(`Latest Total Volume: $${volumes[volumes.length - 1].toLocaleString()}`);
  console.log(`Volume Change: ${volumeChange.toFixed(2)}%`);
  console.log(`Number of Data Points: ${data.length}`);
}

// Run analysis
analyzeTrends();
