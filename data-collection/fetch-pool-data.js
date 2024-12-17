const axios = require('axios');
require('dotenv').config({ path: './.env' });

async function fetchPoolData(token0, token1) {
    const endpoint = process.env.UNISWAP_SUBGRAPH_URL;
    const [sortedToken0, sortedToken1] = [token0, token1].sort((a, b) => a.localeCompare(b));

    const query = `
    {
        pools(
            first: 1,
            where: { token0: "${sortedToken0}", token1: "${sortedToken1}" }
        ) {
            id
            feeTier
            sqrtPrice
            liquidity
            tick
        }
    }`;

    try {
        console.log(`Querying pool for: ${sortedToken0} - ${sortedToken1}`);
        const response = await axios.post(endpoint, { query });
        return response.data.data.pools[0] || null;
    } catch (error) {
        console.error('Error fetching pool data:', error.message);
        return null;
    }
}

module.exports = { fetchPoolData };
