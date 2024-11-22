require("dotenv").config();
const { ethers, parseUnits } = require("ethers");

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
    const signer = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

    const tokenAAddress = process.env.TOKEN_A_ADDRESS;
    const tokenBAddress = process.env.TOKEN_B_ADDRESS;
    const dexAddress = process.env.UNISWAP_V3_ADDRESS;

    const uniswapAbi = [
        "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint[] memory)"
    ];

    const dexContract = new ethers.Contract(dexAddress, uniswapAbi, signer);

    const amountIn = parseUnits("1.0", 18);
    const amountOutMin = parseUnits("0.9", 18);
    const path = [tokenAAddress, tokenBAddress];
    const to = signer.address;
    const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

    try {
        console.log("Initiating token swap...");
        const txResponse = await dexContract.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            to,
            deadline,
            { gasLimit: 500000, gasPrice: ethers.parseUnits('10', 'gwei') }
        );
        console.log("Transaction sent. Response:", txResponse);

        const txReceipt = await txResponse.wait();
        console.log("Transaction confirmed. Receipt:", txReceipt);

        if (txReceipt) {
            console.log("Transaction confirmed. Hash:", txReceipt.transactionHash);
        } else {
            console.log("Transaction failed or receipt not found.");
        }
    } catch (error) {
        console.error("Error executing trade:", error);
        if (error.receipt) {
            console.log("Error Receipt:", error.receipt);
        }
    }
}

main().catch((error) => {
    console.error("Error in trade execution:", error);
    process.exitCode = 1;
});
