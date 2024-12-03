const { ethers } = require('ethers');

async function executeLiveTrade(signal, amount) {
  console.log('--- Executing Live Trade ---');
  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

  console.log(`Signal: ${signal}`);
  console.log(`Amount: ${amount} ETH`);

  // Example: Send transaction (adjust logic based on trading needs)
  const tx = await wallet.sendTransaction({
    to: '<target_wallet_or_contract>',
    value: ethers.utils.parseEther(amount.toString()),
  });

  console.log('Transaction sent:', tx.hash);
  await tx.wait();
  console.log('Transaction confirmed!');
}

module.exports = { executeLiveTrade };
