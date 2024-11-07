require('dotenv').config();

const targetBalances = {
    polygon: 500,
    avalanche: 300,
    fantom: 200
};

module.exports = {
    targetBalances,
    METAMASK_PRIVATE_KEY: process.env.METAMASK_PRIVATE_KEY,
    RPC_URL_ETHEREUM: process.env.ETHEREUM_MAINNET_RPC_URL_1,
    RPC_URL_POLYGON: process.env.POLYGON_MAINNET_RPC_URL_1
    // Add additional variables as needed
};
