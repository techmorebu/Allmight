require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

// Safe account loader -- skips missing or placeholder keys
const rawKey = process.env.METAMASK_PRIVATE_KEY || "";
// Accept key with or without 0x prefix; reject placeholders and wrong length.
const cleanKey = rawKey.replace(/^0x/i, "");
const accounts = (cleanKey && cleanKey !== "****" && /^[0-9a-fA-F]{64}$/.test(cleanKey))
  ? [`0x${cleanKey}`]
  : [];

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  networks: {
    // Arbitrum mainnet fork -- used for all local testing
    // NOTE: chainId is intentionally left as default (31337).
    // Setting chainId: 42161 causes EDR to look up Arbitrum's hardfork
    // history which it doesn't have, producing "No known hardfork" errors.
    // The fork still uses Arbitrum RPC and all contract state is correct.
    hardhat: {
      forking: {
        url: process.env.ARBITRUM_MAINNET_RPC_URL_1,
        enabled: true,
        blockNumber: 457129857,
      },
    },
    arbitrum: {
      url: process.env.ARBITRUM_MAINNET_RPC_URL_1,
      accounts,
      chainId: 42161,
    },
    sepolia: {
      url: process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL,
      accounts,
    },
    mainnet: {
      url: process.env.ETHEREUM_MAINNET_RPC_URL_1,
      accounts,
    },
    polygon: {
      url: process.env.POLYGON_MAINNET_RPC_URL_1,
      accounts,
    },
  },
};
