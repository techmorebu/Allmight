const ethers = require("ethers");

function evaluateTrade(price1, price2) {
  const ratio = price1 / price2;
  return ratio > 1.05;  // Example threshold
}

module.exports = { evaluateTrade };
