// scripts/deployFlashLoan.js
async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    const FlashLoan = await ethers.getContractFactory("OFAFlashLoan");
    const flashLoan = await FlashLoan.deploy(process.env.AAVE_POOL_ADDRESS_PROVIDER_ETHEREUM_TESTNET);
    console.log("Flash Loan contract deployed to:", flashLoan.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
