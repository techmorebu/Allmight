
const { ethers } = require("hardhat");

describe("SimpleStorage", function () {
  let simpleStorage;

  beforeEach(async () => {
    const SimpleStorage = await ethers.getContractFactory("SimpleStorage");
    simpleStorage = await SimpleStorage.deploy();
    await simpleStorage.deployed();
  });

  it("Should set and get the correct value", async () => {
    await simpleStorage.set(42);
    const value = await simpleStorage.get();
    expect(value).to.equal(42);
  });

  it("Should emit an event on data update", async () => {
    await expect(simpleStorage.set(42))
      .to.emit(simpleStorage, "DataUpdated")
      .withArgs(0, 42);
  });
});
