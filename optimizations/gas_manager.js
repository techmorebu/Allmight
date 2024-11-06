const { ethers } = require("ethers");

async function estimateGasCost(transaction) {
    try {
        const gasEstimate = await transaction.estimateGas();
        const gasPrice = await ethers.provider.getGasPrice();
        return gasEstimate.mul(gasPrice);
    } catch (error) {
        console.error("Error estimating gas cost:", error);
        return null;
    }
}

module.exports = {
    estimateGasCost
};
