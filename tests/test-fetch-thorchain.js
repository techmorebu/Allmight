const { fetchThorchainPools, fetchThorchainSwaps, fetchThorchainFees } = require('../data-collection/fetch-thorchain-data');

(async () => {
    console.log('Testing Thorchain data fetching...');
    await fetchThorchainPools();
    await fetchThorchainSwaps();
    await fetchThorchainFees();
})();
