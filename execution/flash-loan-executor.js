const { ethers } = require('ethers');
require('dotenv').config();

// Load Ethereum provider and wallet
const provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_MAINNET_RPC_URL_1);
const wallet = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

// Aave Flash Loan Contract ABI and Address
const AAVE_FLASH_LOAN_ABI = [
    // Replace with the actual ABI for Aave's Flash Loan function
    "function flashLoan(address receiver, address asset, uint256 amount, bytes calldata params)"
];
const AAVE_FLASH_LOAN_ADDRESS = process.env.AAVE_FLASH_LOAN_ADDRESS;

/**
 * Execute a flash loan and swap assets to capture arbitrage opportunities.
 * @param {string} asset - Address of the asset to borrow
 * @param {string} amount - Amount to borrow (in wei)
 * @param {string} dexA - First DEX for buying
 * @param {string} dexB - Second DEX for selling
 */
async function executeFlashLoan(asset, amount, dexA, dexB) {
    try {
        console.log('Starting flash loan execution...');
        console.log(`Borrowing ${ethers.utils.formatUnits(amount, 18)} of ${asset}`);

        const flashLoanContract = new ethers.Contract(AAVE_FLASH_LOAN_ADDRESS, AAVE_FLASH_LOAN_ABI, wallet);

        // Prepare encoded parameters for the flash loan callback
        const params = ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "uint256"],
            [dexA, dexB, amount]
        );

        // Execute the flash loan
        const tx = await flashLoanContract.flashLoan(wallet.address, asset, amount, params);
        console.log(`Transaction sent: ${tx.hash}`);

        // Wait for confirmation
        await tx.wait();
        console.log('Flash loan executed successfully.');
    } catch (error) {
        console.error('❌ Flash loan execution failed:', error.message);
    }
}

module.exports = { executeFlashLoan };
