require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");
const { task } = require("hardhat/config");

module.exports = {
  solidity: "0.8.20",
  networks: {
    mainnet: {
      url: process.env.ETHEREUM_MAINNET_RPC_URL_1,
      accounts: [`0x${process.env.METAMASK_PRIVATE_KEY}`]
    },
    sepolia: {
      url: process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL,
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
    // Add other networks as necessary
  }
};

// Custom task to list accounts
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();
  for (const account of accounts) {
    console.log(account.address);
  }
});
