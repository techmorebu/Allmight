const fetch = require("node-fetch");
require("dotenv").config();

async function fetchUniswapData() {
  const query = `
  {
    pools(first: 10) {
      id
      token0 {
        symbol
        derivedETH
      }
      token1 {
        symbol
        derivedETH
      }
      volumeUSD
      liquidity
      ticks {
        price0
        price1
        tickLower
        tickUpper
      }
      feesUSD
      txCount
    }
  }`;

  try {
    const response = await fetch(process.env.UNISWAP_DEX_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = await response.json();

    // Format and return the data
    const poolData = data.data.pools.map((pool) => ({
      poolId: pool.id,
      token0: {
        symbol: pool.token0.symbol,
        price: pool.token0.derivedETH,
      },
      token1: {
        symbol: pool.token1.symbol,
        price: pool.token1.derivedETH,
      },
      volumeUSD: pool.volumeUSD,
      liquidity: pool.liquidity,
      ticks: pool.ticks,
      feesUSD: pool.feesUSD,
      txCount: pool.txCount,
    }));

    console.log("Fetched Uniswap Data:", poolData);
    return poolData;
  } catch (error) {
    console.error("Error fetching Uniswap data:", error.message);
    return [];
  }
}

module.exports = fetchUniswapData;

// Example Usage
if (require.main === module) {
  fetchUniswapData().then((data) =>
    console.log("Fetched Uniswap Pools:", data)
  );
}
