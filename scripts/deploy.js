require("dotenv").config();
const hre = require("hardhat");

async function main() {
    const SimpleStorageFactory = await ethers.getContractFactory("SimpleStorage");
  console.log("Deploying contract...");
  const simpleStorage = await SimpleStorageFactory.deploy();
  console.log("Waiting for contract to deployed...");
  await simpleStorage.deployed();
  console.log("Contract address");
  console.log(simpleStorage.address);

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
