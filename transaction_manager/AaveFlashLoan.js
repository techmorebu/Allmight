require('dotenv').config();
const { ethers } = require('ethers');

// Aave Flash Loan function
async function executeAaveFlashLoan(asset, amount) {
    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
        const signer = provider.getSigner();
        const aaveFlashLoanContract = new ethers.Contract(
            process.env.AAVE_FLASH_LOAN_ADDRESS,
            AAVE_FLASH_LOAN_ABI,
            signer
        );

        const tx = await aaveFlashLoanContract.flashLoan(
            process.env.YOUR_CONTRACT_ADDRESS,  // Contract address executing the loan
            asset,                               // Asset to borrow
            amount,                              // Amount to borrow
            0                                    // Referral code (0 if unused)
        );
        await tx.wait();
        console.log("Aave flash loan executed successfully!");
    } catch (error) {
        console.error("Error executing Aave flash loan:", error);
    }
}

module.exports = { executeAaveFlashLoan };
