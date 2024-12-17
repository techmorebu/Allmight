const { fetchTokenPrices } = require('../data-collection/fetchData');

(async () => {
    try {
        console.log('Fetching Token Prices...');
        const tokenData = await fetchTokenPrices();
        console.log('Token Prices:', JSON.stringify(tokenData, null, 2));
    } catch (error) {
        console.error('Error fetching token prices:', error.message);
    }
})();
