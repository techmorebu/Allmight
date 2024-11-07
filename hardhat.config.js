require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
require("dotenv").config();

module.exports = {
    solidity: "0.8.17",
    networks: {
        ethereum: {
            url: process.env.ETHEREUM_MAINNET_RPC_URL_1,
            accounts: [process.env.METAMASK_PRIVATE_KEY]
        },
        polygon: {
            url: process.env.POLYGON_MAINNET_RPC_URL_1,
            accounts: [process.env.METAMASK_PRIVATE_KEY]
        },
        // Add other networks as needed
    }
};
