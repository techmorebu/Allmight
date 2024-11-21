require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
    try {
        // Set up provider and signer
        const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
        const signer = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

        // Replace with your deployed contract address
        const contractAddress = "0x52F56Eba61EC93F52990c210C62859332fa2a8B7";

        // Define the contract ABI
        const abi = [
            "function retrieve() public view returns (uint256)",
            "function store(uint256 _favoriteNumber) public",
            
        ];

        // Connect to the contract
        const simpleStorage = new ethers.Contract(contractAddress, abi, signer);

        // Retrieve the current value
        console.log("Retrieving value...");
        const currentValue = await simpleStorage.retrieve();
        console.log("Value retrieved:", currentValue.toString());

        // Update the value
        console.log("Estimating gas for `store`...");
        const gasEstimateStore = await simpleStorage.estimateGas.store(42);
        console.log("Gas estimate for `store`:", gasEstimateStore.toString());

        console.log("Storing value...");
        const txResponse = await simpleStorage.store(42, {
            gasLimit: gasEstimateStore.add(10000), // Add buffer to ensure sufficient gas
        });
        const txReceipt = await txResponse.wait(); // Wait for transaction confirmation
        console.log(`Transaction confirmed with hash: ${txReceipt.transactionHash}`);

        // Retrieve the updated value
        console.log("Retrieving updated value...");
        const updatedValue = await simpleStorage.retrieve();
        console.log("Updated value:", updatedValue.toString());
    } catch (error) {
        console.error("Error in main function:", error);
    }
}

main().catch((error) => {
    console.error("Error in script execution:", error);
    process.exitCode = 1;
});
