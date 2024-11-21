require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
    // Initialize provider and signer
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
    const signer = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

    // Replace with your deployed contract address
    const contractAddress = "0xYourDeployedContractAddress";

    // Define ABI
    const abi = [
        "function get() public view returns (uint256)",
        "function set(uint256 x) public",
    ];

    // Connect to contract
    const simpleStorage = new ethers.Contract(contractAddress, abi, signer);

    // Retrieve current value
    console.log("Retrieving stored value...");
    const currentValue = await simpleStorage.get();
    console.log("Current stored value:", currentValue.toString());

    // Set a new value
    const newValue = 99;
    console.log("Storing a new value...");
    try {
        const txResponse = await simpleStorage.set(newValue, { gasLimit: 100000 });
        console.log("Transaction sent. Waiting for confirmation...");
        const txReceipt = await txResponse.wait();
        console.log(`Transaction confirmed: ${txReceipt.transactionHash}`);
    } catch (error) {
        console.error("Error during transaction:", error);
        return;
    }

    // Retrieve updated value
    console.log("Retrieving updated value...");
    const updatedValue = await simpleStorage.get();
    console.log("Updated stored value:", updatedValue.toString());
}

main().catch((error) => {
    console.error("Error in main function:", error);
    process.exitCode = 1;
});
