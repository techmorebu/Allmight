require('dotenv').config();
const { ethers } = require('ethers');

async function executeBalancerFlashLoan(asset, amount) {
    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
        const signer = provider.getSigner();
        const balancerFlashLoanContract = new ethers.Contract(
            process.env.BALANCER_FLASH_LOAN_ADDRESS,
            BALANCER_FLASH_LOAN_ABI,
            signer
        );

        const tx = await balancerFlashLoanContract.flashLoan(
            process.env.YOUR_CONTRACT_ADDRESS,
            asset,
            amount
        );
        await tx.wait();
        console.log("Balancer flash loan executed successfully!");
    } catch (error) {
        console.error("Error executing Balancer flash loan:", error);
    }
}

module.exports = { executeBalancerFlashLoan };
