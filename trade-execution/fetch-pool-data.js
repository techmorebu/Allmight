const axios = require('axios');
require('dotenv').config({ path: '/home/techbu/OFA_Project_Local/ofa-project/.env' });

async function fetchPoolData(token0, token1) {
  const endpoint = process.env.UNISWAP_SUBGRAPH_URL;

  const query = `
    {
      pools(
        first: 1,
        where: {
          token0: "${token0.toLowerCase()}",
          token1: "${token1.toLowerCase()}"
        }
      ) {
        id
        feeTier
        sqrtPrice
        liquidity
        tick
      }
    }
  `;

  try {
    console.log('Sending Query to Subgraph:', query); // Log query for debugging
    const response = await axios.post(endpoint, { query });

    if (response.data.errors) {
      console.error('Subgraph returned errors:', response.data.errors);
      return null;
    }

    const poolData = response.data.data.pools[0];

    if (!poolData) {
      console.error('Pool not found. Ensure the token pair and Subgraph URL are correct.');
      return null;
    }

    console.log('Fetched Pool Data:', poolData);
    return {
      feeTier: parseInt(poolData.feeTier),
      sqrtPriceX96: poolData.sqrtPrice,
      liquidity: poolData.liquidity,
      tick: poolData.tick,
    };
  } catch (error) {
    console.error('Error fetching pool data:', error.message);
    return null;
  }
}

module.exports = { fetchPoolData };

// Test Example
if (require.main === module) {
  const token0 = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // USDC
  const token1 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'; // WETH
  fetchPoolData(token0, token1);
}
