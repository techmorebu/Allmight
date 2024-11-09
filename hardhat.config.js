require('dotenv').config();

module.exports = {
  networks: {
    ethereumMainnet: {
      url: process.env.ETHEREUM_MAINNET_RPC_URL_1,
      accounts: [process.env.METAMASK_PRIVATE_KEY]
    },
    polygonMainnet: {
      url: process.env.POLYGON_MAINNET_RPC_URL_1,
      accounts: [process.env.METAMASK_PRIVATE_KEY]
    },
    // Add configurations for each network as defined in the .env file
  },
  // Add Solidity compiler settings, etc.
};
