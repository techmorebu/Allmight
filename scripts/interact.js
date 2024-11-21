require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
    const signer = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

    const contractAddress = "0x2D049B8fF112fC990FeF9711D5f1A14989b6A140"; // Replace with your deployed contract address
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
        console.error("Error calling retrieve():", error);
    }

    try {
        console.log("Storing value...");
        const txResponse = await simpleStorage.store(42);
        const txReceipt = await txResponse.wait();
        console.log("Transaction confirmed:", txReceipt.transactionHash);
    } catch (error) {
        console.error("Error storing value:", error);
    }
}

main().catch((error) => {
    console.error("Error in main():", error);
});
