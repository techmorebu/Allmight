require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");

module.exports = {
  solidity: "0.8.20",  // Using the latest stable version of Solidity
  networks: {
    mainnet: {
      url: process.env.ETHEREUM_MAINNET_RPC_URL_1,
      accounts: [`0x${process.env.METAMASK_PRIVATE_KEY}`]
    },
    polygon: {
      url: process.env.POLYGON_MAINNET_RPC_URL_1,
      accounts: [`0x${process.env.METAMASK_PRIVATE_KEY}`]
    },
    zksync: {
      url: process.env.ZKSYNC_MAINNET_RPC_URL,
      accounts: [`0x${process.env.METAMASK_PRIVATE_KEY}`]
    },
    // Add other networks here following the same pattern
  }
};
