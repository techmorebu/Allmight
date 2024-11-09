// Example: Corrected deploy script
async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    const OFAFlashLoan = await ethers.getContractFactory("OFAFlashLoan");
    const ofaBase = await OFAFlashLoan.deploy(process.env.AAVE_POOL_ADDRESS_PROVIDER_ETHEREUM_TESTNET);

    await ofaBase.deployed();  // Correct placement of deployed()

    console.log("OFA Flash Loan contract deployed to:", ofaBase.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
