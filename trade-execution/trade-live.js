const { ethers } = require('ethers5'); // Use ethers version 5.7.2
const { fetchPoolData } = require('./fetch-pool-data');
require('dotenv').config({ path: '/home/techbu/OFA_Project_Local/ofa-project/.env' });

async function executeLiveTrade(token0, token1, tradeAmount) {
  console.log('--- Starting Live Trade Execution ---');

  try {
    console.log('Fetching Pool Data...');
    const poolData = await fetchPoolData(token0, token1);

    if (!poolData) {
      console.error('Error: Pool data not found. Trade execution aborted.');
      return;
    }

    console.log('Fetched Pool Data:', poolData);

    const provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_MAINNET_RPC_URL_1);
    const wallet = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

    console.log('Wallet connected:', wallet.address);

    // Define trade amount in Wei
    const tradeAmountInWei = ethers.utils.parseUnits(tradeAmount.toString(), 'ether');
    console.log(`Trade Amount in Wei: ${tradeAmountInWei.toString()}`);

    // Placeholder for trade execution logic
    // Example of sending ETH (adjust according to your trade logic)
    const tx = await wallet.sendTransaction({
      to: poolData.id, // Replace with the actual recipient address if applicable
      value: tradeAmountInWei,
    });

    console.log('Trade executed. Transaction Hash:', tx.hash);

    // Wait for the transaction to be mined
    const receipt = await tx.wait();
    console.log('Transaction confirmed in block:', receipt.blockNumber);
  } catch (error) {
    console.error('Error executing trade:', error.message);
  }
}

async function main() {
  const tokenPairs = [
    { token0: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', tradeAmount: 1 }, // USDC/WETH
    { token0: '0x6b175474e89094c44da98b954eedeac495271d0f', token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', tradeAmount: 0.5 }, // DAI/WETH
  ];

  for (const { token0, token1, tradeAmount } of tokenPairs) {
    console.log(`Querying pool for: ${token0} - ${token1}`);
    await executeLiveTrade(token0, token1, tradeAmount);
  }
}

// Run the script if executed directly
if (require.main === module) {
  main();
}

module.exports = { executeLiveTrade };
