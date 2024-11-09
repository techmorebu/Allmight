require("@nomicfoundation/hardhat-ethers");
require("dotenv").config();

module.exports = {
    solidity: "0.8.17",
    networks: {
        ethereum: {
            url: process.env.ETHEREUM_MAINNET_RPC_URL,
            accounts: [process.env.METAMASK_PRIVATE_KEY]
        },
        polygon: {
            url: process.env.POLYGON_MAINNET_RPC_URL,
            accounts: [process.env.METAMASK_PRIVATE_KEY]
        },
        zksync: {
            url: process.env.ZKSYNC_MAINNET_RPC_URL,
            accounts: [process.env.METAMASK_PRIVATE_KEY]
        },
        scroll: {
            url: process.env.SCROLL_MAINNET_RPC_URL_1,
            accounts: [process.env.METAMASK_PRIVATE_KEY]
        }
    }
};
