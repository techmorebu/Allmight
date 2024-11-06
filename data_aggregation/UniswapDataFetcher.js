require('dotenv').config();
const axios = require('axios');

// Function to fetch pair data from Uniswap using The Graph
async function getUniswapPairData(assetAddress, pairAddress) {
    try {
        const response = await axios.post(
            'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3',
            {
                query: `
                {
                    pool(id: "${assetAddress}-${pairAddress}") {
                        liquidity
                        volumeUSD
                        token0Price
                        token1Price
                    }
                }
                `
            }
        );
        return response.data.data.pool;
    } catch (error) {
        console.error("Error fetching Uniswap pair data:", error);
        throw error;
    }
}

module.exports = { getUniswapPairData };
