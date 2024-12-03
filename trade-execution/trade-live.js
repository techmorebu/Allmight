const { ethers } = require('ethers');

async function executeLiveTrade(signal, amount) {
  console.log('--- Executing Live Trade ---');
  
  // Initialize Ethereum provider
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

  // Initialize Wallet with private key and provider
  const wallet = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

  console.log(`Signal: ${signal}`);
  console.log(`Amount: ${amount} ETH`);

  // Example: Send transaction (adjust based on your trading logic)
  const tx = await wallet.sendTransaction({
    to: '<target_wallet_or_contract>', // Replace with target address
    value: ethers.parseEther(amount.toString()), // Updated for ethers@6.x
  });

  console.log('Transaction sent:', tx.hash);
  await tx.wait();
  console.log('Transaction confirmed!');
}

module.exports = { executeLiveTrade };
