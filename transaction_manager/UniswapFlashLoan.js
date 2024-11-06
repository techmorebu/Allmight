require('dotenv').config();
const { ethers } = require('ethers');

async function executeUniswapFlashLoan(asset, amount) {
    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
        const signer = provider.getSigner();
        const uniswapV3Contract = new ethers.Contract(
            process.env.UNISWAP_V3_ADDRESS,
            UNISWAP_V3_ABI,
            signer
        );

        const tx = await uniswapV3Contract.flash(
            process.env.YOUR_CONTRACT_ADDRESS,  // The receiver contract
            asset,
            amount,
            "0x" // Any additional parameters as necessary
        );
        await tx.wait();
        console.log("Uniswap V3 flash loan executed successfully!");
    } catch (error) {
        console.error("Error executing Uniswap V3 flash loan:", error);
    }
}

module.exports = { executeUniswapFlashLoan };
