require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
    // Set up provider and signer
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
    const signer = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);
    const contractAddress = "0x52F56Eba61EC93F52990c210C62859332fa2a8B7";
    const abi = [
        "function set(uint256 x) public",
        "function get() public view returns (uint256)"
    ];

    // Connect to the contract
    const simpleStorage = new ethers.Contract(contractAddress, abi, signer);

    try {
        console.log("Retrieving stored value...");
        const currentValue = await simpleStorage.get();
        console.log("Current stored value:", currentValue.toString());

        console.log("Storing a new value...");
        const tx = await simpleStorage.set(42, { gasLimit: 100000 });
        console.log("Transaction sent. Waiting for confirmation...");
        const receipt = await tx.wait();
        console.log("Transaction confirmed:", receipt.transactionHash);

        console.log("Retrieving updated value...");
        const updatedValue = await simpleStorage.get();
        console.log("Updated stored value:", updatedValue.toString());
    } catch (error) {
        console.error("Error in main function:", error);
    }
}

main().catch((error) => {
    console.error("Error in script execution:", error);
    process.exitCode = 1;
});
