const { ethers } = require('ethers5');
const { fetchPoolData } = require('./fetch-pool-data');
require('dotenv').config({ path: '/home/techbu/OFA_Project_Local/ofa-project/.env' });

async function executeTrade(token0, token1, tradeAmountInEth) {
  console.log(`Querying pool for: ${token0} - ${token1}`);
  
  const poolData = await fetchPoolData(token0, token1);
  if (!poolData) {
    console.error('Pool data not found. Aborting trade.');
    return;
  }
  
  console.log('Fetched Pool Data:', poolData);

  // Connect wallet
  const provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_MAINNET_RPC_URL_1);
  const wallet = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);
  console.log(`Wallet connected: ${wallet.address}`);
  
  try {
    // Convert trade amount to Wei
    const tradeAmountWei = ethers.utils.parseUnits(tradeAmountInEth.toString(), 'ether');
    console.log(`Trade Amount in Wei: ${tradeAmountWei.toString()}`);
    
    // Get current wallet balance
    const walletBalance = await wallet.getBalance();
    console.log(`Current Wallet Balance: ${ethers.utils.formatEther(walletBalance)} ETH`);
    
    // Estimate gas fees
    const gasEstimate = await provider.estimateGas({
      to: poolData.id,
      value: tradeAmountWei,
    });
    const gasPrice = await provider.getGasPrice();
    const estimatedCost = gasPrice.mul(gasEstimate).add(tradeAmountWei);

    console.log(`Estimated Gas Fees: ${ethers.utils.formatEther(gasPrice.mul(gasEstimate))} ETH`);
    console.log(`Estimated Total Transaction Cost: ${ethers.utils.formatEther(estimatedCost)} ETH`);

    // Check for sufficient funds
    if (walletBalance.lt(estimatedCost)) {
      console.error(
        `Insufficient funds: Wallet balance is ${ethers.utils.formatEther(walletBalance)} ETH, ` +
        `but transaction requires ${ethers.utils.formatEther(estimatedCost)} ETH.`
      );
      return;
    }

    // Execute trade (dummy example, replace with actual trade logic)
    const tx = await wallet.sendTransaction({
      to: poolData.id,
      value: tradeAmountWei,
      gasLimit: gasEstimate,
      gasPrice,
    });
    console.log('Trade executed:', tx.hash);
  } catch (error) {
    console.error('Error executing trade:', error.message);
  }
}

// Example execution
(async () => {
  const token0 = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // USDC
  const token1 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'; // WETH
  const tradeAmountInEth = 1; // Trade 1 ETH
  
  await executeTrade(token0, token1, tradeAmountInEth);
})();
