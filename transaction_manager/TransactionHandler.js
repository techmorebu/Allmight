const { ethers } = require("ethers");
const { estimateGasCost } = require("../optimizations/gas_manager");

async function executeTrade(transactionDetails) {
    try {
        const gasCost = await estimateGasCost(transactionDetails);

        if (!gasCost) {
            console.log("Unable to estimate gas. Aborting transaction.");
            return;
        }

        // Execute trade if gas cost is within budget
        if (transactionDetails.profit.gt(gasCost)) {
            const tx = await transactionDetails.execute();
            await tx.wait();
            console.log("Trade executed successfully!");
        } else {
            console.log("Trade not profitable due to gas costs.");
        }
    } catch (error) {
        console.error("Error executing trade:", error);
    }
}

module.exports = {
    executeTrade
};
