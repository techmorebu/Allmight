const axios = require('axios');
require('dotenv').config({ path: '/home/techbu/OFA_Project_Local/ofa-project/.env' });

// Fetch Pool Data for a given token pair
async function fetchPoolData(token0, token1) {
  const endpoint = process.env.UNISWAP_SUBGRAPH_URL;

  // Sort tokens to ensure consistent ordering
  const [sortedToken0, sortedToken1] = [token0, token1].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // GraphQL query
  const query = `
    {
      pools(
        first: 1,
        where: {
          token0: "${sortedToken0.toLowerCase()}",
          token1: "${sortedToken1.toLowerCase()}"
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
    console.log(`Querying pool for: ${sortedToken0} - ${sortedToken1}`);
    const response = await axios.post(endpoint, { query });

    if (response.data.errors) {
      console.error('Subgraph errors:', response.data.errors);
      return null;
    }

    const pool = response.data.data.pools[0];
    if (!pool) {
      console.error('No pool data found for the given pair:', { token0, token1 });
      return null;
    }

    return {
      id: pool.id,
      feeTier: parseInt(pool.feeTier),
      sqrtPriceX96: pool.sqrtPrice,
      liquidity: pool.liquidity,
      tick: parseInt(pool.tick),
    };
  } catch (error) {
    console.error('Error fetching pool data:', error.message);
    return null;
  }
}

// Fetch pools for a list of token pairs
async function fetchTokenPairsAndPools() {
  const tokenPairs = [
    { token0: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' }, // USDC/WETH
    { token0: '0x6b175474e89094c44da98b954eedeac495271d0f', token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' }, // DAI/WETH
    // Add more pairs as needed
  ];

  for (const { token0, token1 } of tokenPairs) {
    const poolData = await fetchPoolData(token0, token1);
    if (poolData) {
      console.log('Fetched Pool Data:', poolData);
    } else {
      console.log(`No pool data found for pair: ${token0} - ${token1}`);
    }
  }
}

// Export functions for use in other scripts
module.exports = { fetchPoolData, fetchTokenPairsAndPools };

// Execute if run directly
if (require.main === module) {
  fetchTokenPairsAndPools();
}
