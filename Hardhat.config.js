require("dotenv").config();

const isTestMode = process.env.MODE === "TEST_FIRE";

module.exports = {
    solidity: "0.8.20",
    networks: {
        hardhat: {},
        ethereum: {
            url: isTestMode
                ? process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL
                : process.env.ETHEREUM_MAINNET_RPC_URL,
            accounts: [process.env.PRIVATE_KEY]
        },
        polygon: {
            url: isTestMode
                ? process.env.POLYGON_TESTNET_AMOY_RPC_URL
                : process.env.POLYGON_MAINNET_RPC_URL,
            accounts: [process.env.PRIVATE_KEY]
        },
        scroll: {
            url: isTestMode
                ? process.env.SCROLL_TESTNET_RPC_URL
                : process.env.SCROLL_MAINNET_RPC_URL,
            accounts: [process.env.PRIVATE_KEY]
        }
    }
};
