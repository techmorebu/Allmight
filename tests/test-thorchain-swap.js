const { executeThorchainSwap } = require('../execution/execute-thorchain-swap');

(async () => {
    console.log('Testing Thorchain swap execution...');
    const fromAsset = 'BTC.BTC';
    const toAsset = 'ETH.ETH';
    const amount = 1000000; // 1 BTC in satoshis
    const toAddress = 'YOUR_ETH_ADDRESS';

    await executeThorchainSwap(fromAsset, toAsset, amount, toAddress);
})();
