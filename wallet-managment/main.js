const { initializeWallet, getNativeBalance, getTokenBalance, checkSufficientBalance } = require("./utils");

async function main() {
    try {
        console.log("Initializing wallet...");
        const wallet = initializeWallet();

        // Fetch native token balance
        console.log("Fetching native token balance...");
        const nativeBalance = await getNativeBalance(wallet);
        console.log(`Native token balance: ${nativeBalance} ETH`);

        // Fetch ERC-20 token balance
        console.log("Fetching ERC-20 token balance...");
        const tokenAddress = process.env.TOKEN_A_ADDRESS; // Ensure this is defined in .env
        const tokenBalance = await getTokenBalance(wallet, tokenAddress);
        console.log(`Token balance: ${tokenBalance} units`);

        // Check if wallet has sufficient balance for a transaction
        console.log("Checking sufficient balance...");
        const amountToCheck = "0.1"; // Example: 0.1 ETH
        const hasSufficientBalance = await checkSufficientBalance(wallet, amountToCheck);

        if (hasSufficientBalance) {
            console.log(`Wallet has sufficient balance for ${amountToCheck} ETH.`);
        } else {
            console.error(`Insufficient balance for ${amountToCheck} ETH.`);
        }
    } catch (error) {
        console.error("Error in Wallet Management Module:", error.message);
    }
}

main();
