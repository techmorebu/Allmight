require('dotenv').config();
const axios = require('axios');

async function getAaveReserveData(assetAddress) {
    try {
        // Replace with Aave's API endpoint if available or use smart contract interaction here
        const response = await axios.get(`https://api.aave.com/reserve/${assetAddress}`);
        return response.data;
    } catch (error) {
        console.error("Error fetching Aave reserve data:", error);
        throw error;
    }
}

module.exports = { getAaveReserveData };
