require('dotenv').config();
const axios = require('axios');

// Fetch trading pairs dynamically from Uniswap Subgraph
async function fetchTradingPairs() {
    const url = process.env.UNISWAP_API_KEY; // Uniswap subgraph endpoint
    const query = `
    {
        pairs(first: 5, orderBy: createdAtTimestamp, orderDirection: desc) {
            id
            token0 {
                id
                symbol
            }
            token1 {
                id
                symbol
            }
        }
    }`;

    try {
        const response = await axios.post(url, { query });
        const pairs = response.data.data.pairs;

        console.log('Latest Trading Pairs:');
        pairs.forEach(pair => {
            console.log(`Pair ID: ${pair.id}`);
            console.log(`Token0: ${pair.token0.symbol} (${pair.token0.id})`);
            console.log(`Token1: ${pair.token1.symbol} (${pair.token1.id})`);
            console.log('---');
        });

        return pairs.map(pair => pair.id); // Return pair IDs
    } catch (error) {
        console.error('Error fetching trading pairs:', error.message);
        return [];
    }
}

module.exports = { fetchTradingPairs };

