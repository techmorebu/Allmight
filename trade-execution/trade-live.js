require('dotenv').config({ path: '../.env' });
const ethers = require('ethers5');
const { fetchPoolData } = require('./fetch-pool-data');

async function executeTrade(token0, token1, tradeAmountInEth) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Querying pool for: ${token0} - ${token1}`);
  
  const poolData = await fetchPoolData(token0, token1);
  if (!poolData) {
    console.error(`[${timestamp}] Pool data not found. Aborting trade.`);
    return;
  }

  console.log(`[${timestamp}] Fetched Pool Data:`);
  console.log(`  - Pool ID: ${poolData.id}`);
  console.log(`  - Fee Tier: ${poolData.feeTier} (${poolData.feeTier / 10000}%)`);
  console.log(`  - SqrtPriceX96: ${poolData.sqrtPriceX96}`);
  console.log(`  - Liquidity: ${poolData.liquidity}`);
  console.log(`  - Tick: ${poolData.tick}`);

  const provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_MAINNET_RPC_URL_1);
  const wallet = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);
  const walletAddress = wallet.address;
  console.log(`[${timestamp}] Wallet connected: ${walletAddress}`);

  try {
    const tradeAmountWei = ethers.utils.parseUnits(tradeAmountInEth.toString(), 'ether');
    console.log(`[${timestamp}] Trade Amount in Wei: ${tradeAmountWei.toString()}`);

    const walletBalance = await wallet.getBalance();
    const walletBalanceEth = ethers.utils.formatEther(walletBalance);
    console.log(`[${timestamp}] Wallet ETH Balance: ${walletBalanceEth} ETH`);

    if (walletBalance.isZero()) {
      console.error(`[${timestamp}] Insufficient wallet balance: 0 ETH. Cannot execute the trade.`);
      return;
    }

    const gasEstimate = await provider.estimateGas({
      to: poolData.id,
      value: tradeAmountWei,
    }).catch(() => {
      console.warn(`[${timestamp}] Unable to estimate gas. Falling back to manual gas limit.`);
      return ethers.BigNumber.from(21000); // Default fallback gas limit
    });

    const gasPrice = await provider.getGasPrice();
    const estimatedCost = gasPrice.mul(gasEstimate).add(tradeAmountWei);

    console.log(`[${timestamp}] Gas Price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} Gwei`);
    console.log(`[${timestamp}] Estimated Gas Limit: ${gasEstimate.toString()}`);
    console.log(`[${timestamp}] Estimated Gas Fees: ${ethers.utils.formatEther(gasPrice.mul(gasEstimate))} ETH`);
    console.log(`[${timestamp}] Estimated Total Transaction Cost: ${ethers.utils.formatEther(estimatedCost)} ETH`);

    if (walletBalance.lt(estimatedCost)) {
      console.error(
        `[${timestamp}] Insufficient funds: Wallet balance is ${walletBalanceEth} ETH, ` +
        `but transaction requires ${ethers.utils.formatEther(estimatedCost)} ETH.`
      );
      return;
    }

    if (process.env.LIVE_FIRE === 'true') {
      const tx = await wallet.sendTransaction({
        to: poolData.id,
        value: tradeAmountWei,
        gasLimit: gasEstimate,
        gasPrice,
      });

      console.log(`[${timestamp}] Trade executed successfully! Transaction Hash: ${tx.hash}`);
    } else {
      console.log(`[${timestamp}] LIVE_FIRE Mode: Disabled (Simulation Mode). Trade not executed.`);
    }
  } catch (error) {
    console.error(`[${timestamp}] Error executing trade: ${error.message}`);
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
