// test_arbitrage_logic.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ArbitrageLogic", function () {
  let arbitrageLogic, flashLoan, owner;

  before(async function () {
    [owner] = await ethers.getSigners();
    const UnifiedFlashLoan = await ethers.getContractFactory("UnifiedFlashLoan");
    flashLoan = await UnifiedFlashLoan.deploy("0xAaveAddress", "0xMakerDAOAddress", "0xUniswapV3Address", "0xBalancerAddress");
    await flashLoan.deployed();

    const ArbitrageLogic = await ethers.getContractFactory("ArbitrageLogic");
    arbitrageLogic = await ArbitrageLogic.deploy(flashLoan.address);
    await arbitrageLogic.deployed();
  });

  it("should deploy successfully and link to flash loan provider", async function () {
    expect(await arbitrageLogic.flashLoanProvider()).to.equal(flashLoan.address);
  });

  it("should allow the owner to execute standard arbitrage", async function () {
    await expect(
      arbitrageLogic.executeStandardArbitrage("Aave", "0xTokenIn", "0xTokenOut", ethers.utils.parseUnits("1", 18), 1000)
    ).to.be.revertedWith("Arbitrage: No profit made"); // Expect revert for non-functional test
  });

  it("should allow the owner to execute triangular arbitrage", async function () {
    await expect(
      arbitrageLogic.executeTriangularArbitrage(
        "Aave",
        "0xTokenA",
        "0xTokenB",
        "0xTokenC",
        ethers.utils.parseUnits("1", 18),
        1000
      )
    ).to.be.revertedWith("Arbitrage: No profit made"); // Expect revert for non-functional test
  });
});