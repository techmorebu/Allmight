
require('dotenv').config();
const axios = require('axios');
const { fetchTradingPairs } = require('./pair-retrieval');

// Fetch pair data
async function fetchPairData(pairAddress) {
    const url = process.env.UNISWAP_API_KEY; // Uniswap subgraph endpoint
    const query = `
    {
        pair(id: "${pairAddress}") {
            token0 {
                symbol
            }
            token1 {
                symbol
            }
            reserve0
            reserve1
            token0Price
            token1Price
        }
    }`;

    try {
        const response = await axios.post(url, { query });
        const pairData = response.data.data.pair;

        if (pairData) {
            console.log(`\nPair: ${pairData.token0.symbol}/${pairData.token1.symbol}`);
            console.log(`Price: 1 ${pairData.token0.symbol} = ${pairData.token0Price} ${pairData.token1.symbol}`);
            console.log(`Reserves: ${pairData.reserve0} / ${pairData.reserve1}`);
        } else {
            console.log('No data available for this pair.');
        }
    } catch (error) {
        console.error('Error fetching pair data:', error.message);
    }
}

// Main monitoring function
async function monitorTradingPairs() {
    console.log('Discovering trading pairs...');
    const pairs = await fetchTradingPairs();

    if (pairs.length === 0) {
        console.log('No pairs found. Exiting.');
        return;
    }

    console.log('Starting monitoring for trading pairs...\n');
    for (const pair of pairs) {
        await fetchPairData(pair);
    }
}

// Run the monitor
monitorTradingPairs();
