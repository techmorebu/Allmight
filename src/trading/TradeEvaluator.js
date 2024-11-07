const ethers5 = require("../aave-deps/node_modules/ethers");

function evaluateTrade(price1, price2) {
  const ratio = price1 / price2;
  return ratio > 1.05;
}

module.exports = { evaluateTrade };
