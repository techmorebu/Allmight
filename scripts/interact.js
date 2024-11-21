// scripts/interact.js
require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
    // Set up provider and signer
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL);
    const signer = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

    // Replace with your deployed contract address
    const contractAddress =0xF04c537BBd02395067323762B46fBc9f2ca7b254;

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


techbu@techbu-TP401CA:~/OFA_Project_Local/ofa-project$ npx hardhat run scripts/interact.js --network sepolia
TypeError: invalid value for Contract target (argument="target", value=1.3718599140585089e+48, code=INVALID_ARGUMENT, version=6.13.4)
    at makeError (/home/techbu/OFA_Project_Local/ofa-project/node_modules/ethers/src.ts/utils/errors.ts:687:21)
    at assert (/home/techbu/OFA_Project_Local/ofa-project/node_modules/ethers/src.ts/utils/errors.ts:715:25)
    at assertArgument (/home/techbu/OFA_Project_Local/ofa-project/node_modules/ethers/src.ts/utils/errors.ts:727:5)
    at new BaseContract (/home/techbu/OFA_Project_Local/ofa-project/node_modules/ethers/src.ts/contract/contract.ts:686:23)
    at new Contract (/home/techbu/OFA_Project_Local/ofa-project/node_modules/ethers/src.ts/contract/contract.ts:1120:1)
    at main (/home/techbu/OFA_Project_Local/ofa-project/scripts/interact.js:20:27)
    at Object.<anonymous> (/home/techbu/OFA_Project_Local/ofa-project/scripts/interact.js:39:1)
    at Module._compile (node:internal/modules/cjs/loader:1356:14)
    at Object.Module._extensions..js (node:internal/modules/cjs/loader:1414:10)
    at Module.load (node:internal/modules/cjs/loader:1197:32) {
  code: 'INVALID_ARGUMENT',
  argument: 'target',
  value: 1.3718599140585089e+48,
  shortMessage: 'invalid value for Contract target'
