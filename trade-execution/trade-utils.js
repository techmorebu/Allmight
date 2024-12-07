const { logger } = require('../monitoring/logger');
const { ethers } = require('ethers'); // Ethers.js for on-chain interactions
const { getDexContract } = require('../data-collection/fetch-uniswap-data'); // Fetch DEX contract

async function executeTrade(token, signal, price) {
  try {
    logger.info(`Preparing to execute ${signal} trade for ${token} at price ${price}...`);

    // Fetch DEX contract for the token
    const dexContract = await getDexContract(token);
    if (!dexContract) {
      throw new Error(`Failed to retrieve DEX contract for ${token}`);
    }

    // Ensure sufficient balance and gas
    const walletBalance = await dexContract.getBalance(); // Adjust based on DEX contract
    if (walletBalance.lt(ethers.utils.parseEther('0.01'))) {
      throw new Error(`Insufficient balance for trading ${token}`);
    }

    // Execute trade based on signal
    let tx;
    if (signal === 'Buy') {
      tx = await dexContract.buy(token, { value: ethers.utils.parseEther(price.toString()) });
    } else if (signal === 'Sell') {
      tx = await dexContract.sell(token, { gasLimit: 200000 });
    } else if (signal === 'Hold') {
      logger.info(`Holding position for ${token}. No trade executed.`);
      return { success: true, details: 'Hold signal, no action taken' };
    } else {
      throw new Error(`Invalid signal: ${signal}`);
    }

    // Wait for transaction confirmation
    const receipt = await tx.wait();
    logger.info(`Transaction successful: ${receipt.transactionHash}`);
    return { success: true, details: receipt };
  } catch (error) {
    logger.error(`Trade execution failed for ${token}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

module.exports = { executeTrade };
