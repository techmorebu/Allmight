const hre = require("hardhat");

async function main() {
  const OFABase = await hre.ethers.getContractFactory("OFABase");
  const ofaBase = await OFABase.deploy();

  await ofaBase.deployed();
  console.log("OFA Base deployed to:", ofaBase.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
