require('dotenv').config(); // Load environment variables
const ethers = require('ethers');
const { fetchPoolData } = require('./fetch-pool-data');

async function executeTrade(token0, token1, tradeAmountInEth) {
  console.log(`Querying pool for: ${token0} - ${token1}`);
  
  const poolData = await fetchPoolData(token0, token1);
  if (!poolData) {
    console.error('Pool data not found. Aborting trade.');
    return;
  }
  
  console.log('Fetched Pool Data:', poolData);

  const provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_MAINNET_RPC_URL_1);
  const wallet = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);
  console.log(`Wallet connected: ${wallet.address}`);
  
  try {
    const tradeAmountWei = ethers.utils.parseUnits(tradeAmountInEth.toString(), 'ether');
    console.log(`Trade Amount in Wei: ${tradeAmountWei.toString()}`);
    
    const walletBalance = await wallet.getBalance();
    console.log(`Current Wallet Balance: ${ethers.utils.formatEther(walletBalance)} ETH`);

    if (walletBalance.isZero()) {
      console.error('Insufficient wallet balance: 0 ETH. Cannot execute the trade.');
      return;
    }

    const gasEstimate = await provider.estimateGas({
      to: poolData.id,
      value: tradeAmountWei,
    }).catch(() => {
      console.warn('Unable to estimate gas. Falling back to manual gas limit.');
      return ethers.BigNumber.from(21000); // Default fallback gas limit
    });

    const gasPrice = await provider.getGasPrice();
    const estimatedCost = gasPrice.mul(gasEstimate).add(tradeAmountWei);

    console.log(`Estimated Gas Fees: ${ethers.utils.formatEther(gasPrice.mul(gasEstimate))} ETH`);
    console.log(`Estimated Total Transaction Cost: ${ethers.utils.formatEther(estimatedCost)} ETH`);

    if (walletBalance.lt(estimatedCost)) {
      console.error(
        `Insufficient funds: Wallet balance is ${ethers.utils.formatEther(walletBalance)} ETH, ` +
        `but transaction requires ${ethers.utils.formatEther(estimatedCost)} ETH.`
      );
      return;
    }

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

(async () => {
  const tokenPairs = [
    { token0: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', tradeAmount: 1 }, // USDC/WETH
    { token0: '0x6b175474e89094c44da98b954eedeac495271d0f', token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', tradeAmount: 0.5 }, // DAI/WETH
  ];

  for (const { token0, token1, tradeAmount } of tokenPairs) {
    await executeTrade(token0, token1, tradeAmount);
  }
})();
