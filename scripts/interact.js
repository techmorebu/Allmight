// scripts/interact.js
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
    const signer = new ethers.Wallet(`0x${process.env.METAMASK_PRIVATE_KEY}`, provider);

    // Replace with your deployed contract address
    const contractAddress = 0xF04c537BBd02395067323762B46fBc9f2cab254;

    const abi = [
        "function retrieve() public view returns (uint256)",
        "function store(uint256 _favoriteNumber) public",
    ];

    // Connect to the contract
    const simpleStorage = new ethers.Contract(contractAddress, abi, signer);

    // Interact with the contract
    console.log("Current value stored in contract:");
    const currentValue = await simpleStorage.retrieve();
    console.log(currentValue.toString());

    console.log("Updating value...");
    const txResponse = await simpleStorage.store(42);
    await txResponse.wait(); // Wait for transaction confirmation

    console.log("New value stored in contract:");
    const updatedValue = await simpleStorage.retrieve();
    console.log(updatedValue.toString());
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
