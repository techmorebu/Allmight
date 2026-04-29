require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

// Safe account loader -- skips missing or placeholder keys
const key = process.env.METAMASK_PRIVATE_KEY;
const accounts = key && key !== "****" && key.length === 64
  ? [`0x${key}`]
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
