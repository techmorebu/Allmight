const { fetchTokenPrices } = require('./fetchData');

(async () => {
  try {
    const tokenData = await fetchTokenPrices();
    console.log('Raw Token Data:', JSON.stringify(tokenData, null, 2));
  } catch (error) {
    console.error('Error fetching token prices:', error.message);
  }
})();
