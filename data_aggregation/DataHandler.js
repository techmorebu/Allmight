const axios = require('axios');

async function fetchPriceData(apiUrl) {
    try {
        const response = await axios.get(apiUrl);
        return response.data;
    } catch (error) {
        console.error("Error fetching data:", error);
        return null;
    }
}

module.exports = {
    fetchPriceData
};
