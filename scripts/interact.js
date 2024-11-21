// scripts/interact.js
require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
    // Set up provider and signer
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
    const signer = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

    // Replace with your deployed contract address
    const contractAddress ="0xF04c537BBd02395067323762B46fBc9f2ca7b254";

    // Define the contract ABI
    const abi = [
        "function retrieve() public view returns (uint256)",
        "function store(uint256 _favoriteNumber) public",
    ];

    // Connect to the contract
    const simpleStorage = new ethers.Contract(contractAddress, abi, signer);

    // Retrieve the current value
    console.log("Current value stored in contract:");
    const currentValue = await simpleStorage.retrieve();
    console.log(currentValue.toString());

    // Update the value
    console.log("Updating value...");
    const txResponse = await simpleStorage.store(42);
    const txReceipt = await txResponse.wait(); // Wait for transaction confirmation
    console.log(`Transaction confirmed with hash: ${txReceipt.transactionHash}`);

    // Retrieve the updated value
    console.log("New value stored in contract:");
    const updatedValue = await simpleStorage.retrieve();
    console.log(updatedValue.toString());
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
