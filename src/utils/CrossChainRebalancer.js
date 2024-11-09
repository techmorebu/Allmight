// src/utils/CrossChainRebalancer.js
const ethers = require('ethers');
const { LayerZero } = require('@layerzerolabs/lz-sdk');
require('dotenv').config();

async function checkAndRebalanceBalances(targetBalances) {
  const layerZero = new LayerZero({
    mainnet: process.env.LAYERZERO_MAINNET_API,
    testnet: process.env.LAYERZERO_TESTNET_API,
  });

  for (const network in targetBalances) {
    const provider = new ethers.providers.JsonRpcProvider(
      process.env[`${network.toUpperCase()}_RPC_URL`]
    );
    const wallet = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

    const currentBalance = await wallet.getBalance();
    const targetBalance = ethers.utils.parseEther(targetBalances[network].toString());

    if (currentBalance.lt(targetBalance)) {
      const amountToTransfer = targetBalance.sub(currentBalance);
      console.log(`Rebalancing ${ethers.utils.formatEther(amountToTransfer)} to ${network}`);

      await transferTokens(layerZero, wallet, 'polygon', network, amountToTransfer);
    }
  }
}

async function transferTokens(layerZero, wallet, sourceNetwork, destinationNetwork, amount) {
  try {
    const transferResponse = await layerZero.transfer({
      from: sourceNetwork,
      to: destinationNetwork,
      token: 'native', // Adjust if transferring a specific token
      amount: amount.toString(),
      signer: wallet,
    });

    console.log(`Transfer initiated: ${transferResponse.transactionHash}`);
  } catch (error) {
    console.error(`Error transferring tokens from ${sourceNetwork} to ${destinationNetwork}:`, error);
  }
}

module.exports = { checkAndRebalanceBalances };
