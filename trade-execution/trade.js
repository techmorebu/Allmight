require("dotenv").config();
const { ethers, parseUnits } = require("ethers"); // Import parseUnits directly

async function main() {
    // Set up provider and signer
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
    const signer = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

    // Define token addresses from .env
    const tokenAAddress = process.env.TOKEN_A_ADDRESS;
    const tokenBAddress = process.env.TOKEN_B_ADDRESS;

    // Example trade ABI (modify based on your DEX/contract interaction)
    const uniswapAbi = [
        "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint[] memory)"
    ];

    // Define the DEX address (replace with your DEX address)
    const dexAddress = process.env.UNISWAP_V3_ADDRESS;

    // Connect to the DEX contract
    const dexContract = new ethers.Contract(dexAddress, uniswapAbi, signer);

    // Trade parameters
    const amountIn = parseUnits("1.0", 18); // 1 tokenA
    const amountOutMin = parseUnits("0.9", 18); // Expected minimum output
    const path = [tokenAAddress, tokenBAddress]; // TokenA -> TokenB swap path
    const to = signer.address; // Recipient of swapped tokens
    const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // Transaction deadline (10 minutes from now)

    try {
        console.log("Initiating token swap...");
        const txResponse = await dexContract.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            to,
            deadline
        );
        console.log("Transaction sent:", txResponse.hash);

        // Wait for transaction confirmation
        const txReceipt = await txResponse.wait();
        console.log("Transaction confirmed:", txReceipt.transactionHash);
    } catch (error) {
        console.error("Error executing trade:", error.message);
    }
}

main().catch((error) => {
    console.error("Error in trade execution:", error.message);
    process.exitCode = 1;
});
