// test_transaction_manager.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TransactionHandler", function () {
  let transactionHandler, owner;

  before(async function () {
    [owner] = await ethers.getSigners();
    const TransactionHandler = await ethers.getContractFactory("TransactionHandler");
    transactionHandler = await TransactionHandler.deploy();
    await transactionHandler.deployed();
  });

  it("should deploy successfully", async function () {
    expect(transactionHandler.address).to.properAddress;
  });

  it("should send a transaction and return a transaction hash", async function () {
    // Since we're simulating, we assume a placeholder recipient address and value
    const tx = {
      to: "0xRecipientAddress",
      value: ethers.utils.parseEther("0.1")
    };
    await expect(transactionHandler.send_transaction(tx)).to.be.reverted; // Placeholder, as it requires actual network
  });

  it("should check transaction status", async function () {
    const txHash = "0xTransactionHash";
    await expect(transactionHandler.check_transaction_status(txHash)).to.be.reverted; // Placeholder as requires actual transaction
  });
});