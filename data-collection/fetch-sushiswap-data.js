const fetch = require("node-fetch");
require("dotenv").config();

async function fetchSushiswapData() {
  const query = `
  {
    pairs(first: 10) {
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
      reserveUSD
      txCount
    }
  }`;

  try {
    const response = await fetch(process.env.SUSHISWAP_DEX_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = await response.json();

    // Format and return the data
    const pairData = data.data.pairs.map((pair) => ({
      pairId: pair.id,
      token0: {
        symbol: pair.token0.symbol,
        price: pair.token0.derivedETH,
      },
      token1: {
        symbol: pair.token1.symbol,
        price: pair.token1.derivedETH,
      },
      volumeUSD: pair.volumeUSD,
      reserveUSD: pair.reserveUSD,
      txCount: pair.txCount,
    }));

    console.log("Fetched Sushiswap Data:", pairData);
    return pairData;
  } catch (error) {
    console.error("Error fetching Sushiswap data:", error.message);
    return [];
  }
}

module.exports = fetchSushiswapData;

// Example Usage
if (require.main === module) {
  fetchSushiswapData().then((data) =>
    console.log("Fetched Sushiswap Pairs:", data)
  );
}
