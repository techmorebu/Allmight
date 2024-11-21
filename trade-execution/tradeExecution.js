require('dotenv').config();
const { ethers } = require('ethers');
const { abi: routerAbi } = require('@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json');

const INFURA_PROJECT_ID = process.env.INFURA_PROJECT_ID;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const UNISWAP_ROUTER_ADDRESS = process.env.UNISWAP_ROUTER_ADDRESS;

const provider = new ethers.providers.InfuraProvider('mainnet', INFURA_PROJECT_ID);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const router = new ethers.Contract(UNISWAP_ROUTER_ADDRESS, routerAbi, wallet);

async function executeTrade(tokenIn, tokenOut, amountIn, amountOutMin, recipient, deadline) {
  try {
    const params = {
      tokenIn,
      tokenOut,
      fee: 3000, // 0.3% fee tier
      recipient,
      deadline,
      amountIn,
      amountOutMinimum: amountOutMin,
      sqrtPriceLimitX96: 0,
    };

    const tx = await router.exactInputSingle(params, {
      gasLimit: ethers.utils.hexlify(1000000),
    });

    console.log(`Transaction sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
  } catch (error) {
    console.error(`Error executing trade: ${error.message}`);
  }
}

module.exports = { executeTrade };
