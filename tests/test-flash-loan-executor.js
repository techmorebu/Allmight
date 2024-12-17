const { executeFlashLoan } = require('../execution/flash-loan-executor');

(async () => {
    const asset = '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // USDC Example
    const amount = '1000000000000000000'; // 1 USDC in wei
    const dexA = 'Uniswap';
    const dexB = 'GMX';

    console.log('Testing Flash Loan Execution...');
    await executeFlashLoan(asset, amount, dexA, dexB);
})();
