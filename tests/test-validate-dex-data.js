const { validateDexData } = require("../validators/dexValidator");

const testCases = [
  {
    name: "Valid Data",
    data: {
      pair: "ETH-USDC",
      price: 1925.34,
      volumeUSD: 234512.78,
      liquidityUSD: 4539821.34,
      lastUpdated: new Date().toISOString(),
      token0: {
        symbol: "ETH",
        address: "0x123...",
        decimals: 18,
        derivedUSD: 1925.34,
      },
      token1: {
        symbol: "USDC",
        address: "0xabc...",
        decimals: 6,
        derivedUSD: 1.0,
      },
      txCount: 1000,
      swapFee: 0.003,
      platform: "Uniswap",
      chainId: 1,
    },
    expected: true,
  },
  {
    name: "Invalid Field Type",
    data: {
      pair: "ETH-USDC",
      price: "1925.34", // Invalid type
      volumeUSD: 234512.78,
      liquidityUSD: 4539821.34,
      lastUpdated: new Date().toISOString(),
      token0: {
        symbol: "ETH",
        address: "0x123...",
        decimals: 18,
        derivedUSD: 1925.34,
      },
      token1: {
        symbol: "USDC",
        address: "0xabc...",
        decimals: 6,
        derivedUSD: 1.0,
      },
      txCount: 1000,
      swapFee: 0.003,
      platform: "Uniswap",
      chainId: 1,
    },
    expected: false,
  },
];

testCases.forEach(({ name, data, expected }) => {
  const result = validateDexData(data).valid;
  console.log(`${name}: ${result === expected ? "✅ Pass" : "❌ Fail"}`);
});
