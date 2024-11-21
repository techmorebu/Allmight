require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
    const signer = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

    const contractAddress = "0x52F56Eba61EC93F52990c210C62859332fa2a8B7";
    const abi = [
        "function retrieve() public view returns (uint256)",
        "function store(uint256 _favoriteNumber) public",
    ];

    const simpleStorage = new ethers.Contract(contractAddress, abi, signer);

    try {
        console.log("Retrieving value...");
        const value = await simpleStorage.retrieve();
        console.log("Value retrieved:", value.toString());
    } catch (error) {
        console.error("Error retrieving value:", error);
    }

    try {
        console.log("Estimating gas for `store`...");
        const gasEstimateStore = await simpleStorage.estimateGas.store(42);
        console.log("Gas estimate for `store`:", gasEstimateStore.toString());

        console.log("Storing value...");
        const txResponse = await simpleStorage.store(42, {
            gasLimit: gasEstimateStore.add(10000), // Add buffer
        });
        const txReceipt = await txResponse.wait();
        console.log("Transaction confirmed:", txReceipt.transactionHash);
    } catch (error) {
        console.error("Error storing value:", error);
    }
}

main().catch((error) => {
    console.error("Error in main():", error);
});
