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
            {
                "inputs": [],
                "name": "get",
                "outputs": [
                    {
                        "internalType": "uint256",
                        "name": "",
                        "type": "uint256"
                    }
                ],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [
                    {
                        "internalType": "uint256",
                        "name": "x",
                        "type": "uint256"
                    }
                ],
                "name": "set",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [],
                "name": "storedData",
                "outputs": [
                    {
                        "internalType": "uint256",
                        "name": "",
                        "type": "uint256"
                    }
                ],
                "stateMutability": "view",
                "type": "function"
            }
        ];

        // Connect to the contract
        console.log("Connecting to contract...");
        const simpleStorage = new ethers.Contract(contractAddress, abi, signer);

        // Test retrieving value
        console.log("Retrieving value...");
        const currentValue = await simpleStorage.get();
        console.log("Current value:", currentValue.toString());

        // Estimate gas for `set`
        console.log("Estimating gas for set...");
        const gasEstimate = await simpleStorage.estimateGas.set(42);
        console.log("Gas estimate:", gasEstimate.toString());

        // Execute `set`
        console.log("Storing value...");
        const tx = await simpleStorage.set(42, { gasLimit: gasEstimate.add(10000) });
        console.log("Transaction sent. Waiting for confirmation...");
        const receipt = await tx.wait();
        console.log("Transaction confirmed:", receipt.transactionHash);

        // Retrieve the updated value
        console.log("Retrieving updated value...");
        const updatedValue = await simpleStorage.get();
        console.log("Updated value:", updatedValue.toString());
    } catch (error) {
        console.error("Error in main function:", error);
    }
}

main();
