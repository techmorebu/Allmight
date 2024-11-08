require('@nomiclabs/hardhat-ethers');
require('dotenv').config();

module.exports = {
    solidity: '0.8.9',
    networks: {
        mainnet: {
            url: process.env.ETHEREUM_MAINNET_RPC_URL,
            accounts: [process.env.METAMASK_PRIVATE_KEY]
        },
        polygon: {
            url: process.env.POLYGON_MAINNET_RPC_URL,
            accounts: [process.env.METAMASK_PRIVATE_KEY]
        },
        // Add more networks as needed
    }
};
