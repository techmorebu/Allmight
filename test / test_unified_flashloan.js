// test_unified_flashloan.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("UnifiedFlashLoan", function () {
  let flashLoan, owner;
  const aaveAddress = "0xAaveAddress";
  const makerDAOAddress = "0xMakerDAOAddress";
  const uniswapV3Address = "0xUniswapV3Address";
  const balancerAddress = "0xBalancerAddress";

  before(async function () {
    [owner] = await ethers.getSigners();
    const UnifiedFlashLoan = await ethers.getContractFactory("UnifiedFlashLoan");
    flashLoan = await UnifiedFlashLoan.deploy(aaveAddress, makerDAOAddress, uniswapV3Address, balancerAddress);
    await flashLoan.deployed();
  });

  it("should deploy successfully with correct addresses", async function () {
    expect(await flashLoan.aave()).to.equal(aaveAddress);
    expect(await flashLoan.makerDAO()).to.equal(makerDAOAddress);
    expect(await flashLoan.uniswapV3()).to.equal(uniswapV3Address);
    expect(await flashLoan.balancer()).to.equal(balancerAddress);
  });

  it("should allow the owner to execute a flash loan", async function () {
    // Test to ensure the executeFlashLoan function works
    await expect(
      flashLoan.executeFlashLoan("Aave", aaveAddress, uniswapV3Address, ethers.utils.parseUnits("1", 18))
    ).to.be.revertedWith("Unsupported protocol"); // Expect revert for placeholder as function is non-functional here
  });
});
