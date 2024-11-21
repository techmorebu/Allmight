require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
    // Set up provider and signer
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
    const signer = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

    // Replace with your deployed contract address
    const contractAddress = "0xcb75872b3f804a4Bb3c669AC4509DCf8F225CC34";

    // Define the contract ABI
    const abi = [
        "function get() public view returns (uint256)",
        "function set(uint256 x) public"
    ];

    // Connect to the contract
    const simpleStorage = new ethers.Contract(contractAddress, abi, signer);

    // Retrieve the current value
    console.log("Retrieving stored value...");
    try {
        const currentValue = await simpleStorage.get();
        console.log(`Current stored value: ${currentValue}`);
    } catch (error) {
        console.error("Error retrieving value:", error);
        return;
    }

    // Store a new value
    console.log("Storing a new value...");
    try {
        const txResponse = await simpleStorage.set(42);
        console.log(`Transaction sent. Hash: ${txResponse.hash}`);
        
        // Wait for confirmation
        const txReceipt = await txResponse.wait();
        console.log(`Transaction confirmed. Block Number: ${txReceipt.blockNumber}`);
    } catch (error) {
        if (error.code === "INSUFFICIENT_FUNDS") {
            console.error("Error: Insufficient funds to complete the transaction.");
        } else {
            console.error("Error storing value:", error);
        }
        return;
    }

    // Retrieve the updated value
    console.log("Retrieving updated value...");
    try {
        const updatedValue = await simpleStorage.get();
        console.log(`Updated stored value: ${updatedValue}`);
    } catch (error) {
        console.error("Error retrieving updated value:", error);
    }
}

main().catch((error) => {
    console.error("Error in main function:", error);
    process.exitCode = 1;
});
