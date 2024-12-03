const { fetchTokenPrices } = require('../data-collection/fetchData');
const { analyzeTrends } = require('../trade-execution/analyze-trends');

async function main() {
  try {
    console.log('--- Starting Data Pipeline ---');

    // Fetch data
    const tokenPrices = await fetchTokenPrices();
    console.log('Token Prices Fetched:', tokenPrices);

    // Analyze trends
    const trends = analyzeTrends(tokenPrices);
    console.log('Trends Analyzed:', trends);
  } catch (error) {
    console.error('Error in data pipeline:', error.message);
  }
}

main();
