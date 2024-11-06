require('dotenv').config();
const axios = require('axios');

async function getBalancerPoolData(assetAddress, pairAddress) {
    try {
        const response = await axios.post(
            'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-v2',
            {
                query: `
                {
                    pool(id: "${assetAddress}-${pairAddress}") {
                        totalLiquidity
                        swapFee
                        totalSwapVolume
                    }
                }
                `
            }
        );
        return response.data.data.pool;
    } catch (error) {
        console.error("Error fetching Balancer pool data:", error);
        throw error;
    }
}

module.exports = { getBalancerPoolData };
