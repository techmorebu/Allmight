const { executeAaveFlashLoan } = require('./AaveFlashLoan');
const { executeUniswapFlashLoan } = require('./UniswapFlashLoan');
const { executeBalancerFlashLoan } = require('./BalancerFlashLoan');

async function executeFlashLoan(asset, amount) {
    try {
        await executeAaveFlashLoan(asset, amount);
    } catch (error) {
        console.log("Aave flash loan failed, trying Uniswap V3...");
        try {
            await executeUniswapFlashLoan(asset, amount);
        } catch (error) {
            console.log("Uniswap V3 flash loan failed, trying Balancer...");
            try {
                await executeBalancerFlashLoan(asset, amount);
            } catch (error) {
                console.error("All flash loan providers failed.");
            }
        }
    }
}

module.exports = { executeFlashLoan };
