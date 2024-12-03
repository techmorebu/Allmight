const axios = require('axios');
require('dotenv').config();

async function fetchPoolData(token0, token1) {
  const endpoint = process.env.UNISWAP_SUBGRAPH_URL;

  const [sortedToken0, sortedToken1] = [token0, token1].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const query = `{
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
  }`;

  try {
    console.log(`Querying pool for: ${sortedToken0} - ${sortedToken1}`);
    const response = await axios.post(endpoint, { query });

    if (response.data.errors) {
      console.error('Subgraph errors:', response.data.errors);
      return null;
    }

    const pool = response.data.data.pools[0];
    if (!pool) {
      console.error('No pool data found for given pair:', { token0, token1 });
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

module.exports = { fetchPoolData };
