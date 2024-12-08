require('dotenv').config();
const axios = require('axios');

const GMX_ARBITRUM_API = process.env.GMX_ARBITRUM_API;
const GMX_AVALANCHE_API = process.env.GMX_AVALANCHE_API;

const fetchGmxData = async () => {
    try {
        console.log('Fetching GMX data from Arbitrum API...');
        const arbitrumResponse = await axios.get(GMX_ARBITRUM_API);
        const arbitrumPrices = arbitrumResponse.data;

        console.log('Fetching GMX data from Avalanche API...');
        const avalancheResponse = await axios.get(GMX_AVALANCHE_API);
        const avalanchePrices = avalancheResponse.data;

        return {
            arbitrum: {
                prices: arbitrumPrices,
            },
            avalanche: {
                prices: avalanchePrices,
            },
        };
    } catch (error) {
        console.error('Error fetching GMX data:', error.message);
        throw error;
    }
};

module.exports = {
    fetchGmxData,
};
