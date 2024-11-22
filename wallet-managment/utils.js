const { ethers } = require("ethers");
require("dotenv").config();

/**
 * Initialize a provider and wallet
 */
function initializeWallet() {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
    const wallet = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);
    return wallet;
}

/**
 * Fetch wallet balance for native tokens
 */
async function getNativeBalance(wallet) {
    const balance = await wallet.getBalance();
    return ethers.formatEther(balance); // Convert to ETH
}

/**
 * Fetch ERC-20 token balance
 */
async function getTokenBalance(wallet, tokenAddress) {
    const tokenAbi = [
        "function balanceOf(address owner) view returns (uint256)"
    ];
    const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, wallet.provider);
    const balance = await tokenContract.balanceOf(wallet.address);
    return ethers.formatUnits(balance, 18); // Adjust decimals for ERC-20 tokens
}

/**
 * Check if wallet has sufficient balance
 */
async function checkSufficientBalance(wallet, amount) {
    const balance = await getNativeBalance(wallet);
    return ethers.parseEther(amount).lte(ethers.parseEther(balance));
}

module.exports = {
    initializeWallet,
    getNativeBalance,
    getTokenBalance,
    checkSufficientBalance,
};
