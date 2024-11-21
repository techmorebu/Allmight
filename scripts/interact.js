require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
    const signer = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);
    const contractAddress = "0x52F56Eba61EC93F52990c210C62859332fa2a8B7";
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

        // Update the value
        console.log("Setting a new value...");
        const tx = await simpleStorage.set(99, { gasLimit: 50000 }); // Explicit gas limit
        console.log(`Transaction sent: ${tx.hash}`);

        console.log("Waiting for transaction confirmation...");
        const receipt = await provider.getTransactionReceipt(tx.hash);
        console.log("Transaction receipt:", receipt);

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
