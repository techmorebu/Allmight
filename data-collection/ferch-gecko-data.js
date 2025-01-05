const { fetchPoolDataLimited } = require('./geckoTerminalData');

async function fetchAndLogPoolData() {
  try {
    const poolData = await fetchPoolDataLimited('ETH/USDC'); // Replace with desired token pair
    console.log('Fetched Pool Data:', poolData);
  } catch (error) {
    console.error('Error fetching pool data:', error.message);
  }
}

fetchAndLogPoolData();
