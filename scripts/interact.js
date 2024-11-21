require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
    const signer = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);
    const contractAddress = "0xYourDeployedContractAddress";
    const abi = [
        "function set(uint256 x) public",
        "function get() public view returns (uint256)"
    ];
    const simpleStorage = new ethers.Contract(contractAddress, abi, signer);

    try {
        // Retrieve the current value
        console.log("Retrieving current value...");
        const currentValue = await simpleStorage.get();
        console.log(`Current value: ${currentValue.toString()}`);

        // Estimate gas for the transaction
        console.log("Estimating gas for the transaction...");
        const estimatedGas = await simpleStorage.estimateGas.set(99);
        const gasPrice = await provider.getGasPrice();
        const totalCost = estimatedGas.mul(gasPrice);

        console.log(`Estimated gas: ${estimatedGas.toString()}`);
        console.log(`Gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
        console.log(`Total estimated cost: ${ethers.formatEther(totalCost)} ETH`);

        // Check wallet balance
        const walletBalance = await provider.getBalance(signer.address);
        console.log(`Wallet balance: ${ethers.formatEther(walletBalance)} ETH`);

        if (walletBalance.lt(totalCost)) {
            console.error(
                `Insufficient funds: Wallet balance is ${ethers.formatEther(
                    walletBalance
                )} ETH, but the transaction requires at least ${ethers.formatEther(
                    totalCost
                )} ETH.`
            );
            return; // Exit if insufficient funds
        }

        // Update the value
        console.log("Setting a new value...");
        const tx = await simpleStorage.set(99, { gasLimit: estimatedGas });
        console.log(`Transaction sent: ${tx.hash}`);

        console.log("Waiting for transaction confirmation...");
        const receipt = await tx.wait();

        if (receipt && receipt.status === 1) {
            console.log(`Transaction confirmed! Hash: ${receipt.transactionHash}`);
        } else {
            console.error("Transaction failed!");
        }

        // Retrieve the updated value
        console.log("Retrieving updated value...");
        const updatedValue = await simpleStorage.get();
        console.log(`Updated value: ${updatedValue.toString()}`);
    } catch (error) {
        console.error("Error during contract interaction:", error);
    }
}

main().catch((error) => {
    console.error("Error in main function:", error);
    process.exitCode = 1;
});
