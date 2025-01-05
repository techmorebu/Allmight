module.exports = {
  type: "object",
  properties: {
    pair: { type: "string" },
    price: { type: "number" },
    volumeUSD: { type: "number" },
    liquidityUSD: { type: "number" },
    lastUpdated: { type: "string", format: "date-time" },
    token0: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        address: { type: "string" },
        decimals: { type: "number" },
        derivedUSD: { type: "number" }
      },
      required: ["symbol", "address", "decimals"]
    },
    token1: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        address: { type: "string" },
        decimals: { type: "number" },
        derivedUSD: { type: "number" }
      },
      required: ["symbol", "address", "decimals"]
    },
    txCount: { type: "number" },
    feesUSD: { type: "number" },
    tvlToken0: { type: "number" },
    tvlToken1: { type: "number" },
    openPriceUSD: { type: "number" },
    closePriceUSD: { type: "number" },
    highPriceUSD: { type: "number" },
    lowPriceUSD: { type: "number" },
    poolAddress: { type: "string" },
    swapFee: { type: "number" },
    platform: { type: "string" },
    chainId: { type: "number" },
    priceImpact: { type: "number" },
    liquidityProviderCount: { type: "number" },
    whitelisted: { type: "boolean" },
    isStablePool: { type: "boolean" }
  },
  required: ["pair", "price", "volumeUSD", "liquidityUSD", "lastUpdated", "token0", "token1"]
};
