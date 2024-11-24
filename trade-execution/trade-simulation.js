const { ethers } = require('ethers');
const { Token, Pool, Route, Trade, CurrencyAmount, TradeType } = require('@uniswap/sdk-core');
const { fetchPoolData } = require('./fetch-pool-data'); // Import fetchPoolData function
require('dotenv').config({ path: '/home/techbu/OFA_Project_Local/ofa-project/.env' });
const fs = require('fs');

const MAX_TRADE_AMOUNT = 10; // Maximum trade size in ETH

async function executeLiveTrade(signal, amount = 1) {
  if (amount > MAX_TRADE_AMOUNT) {
    console.error(`Trade amount exceeds maximum limit of ${MAX_TRADE_AMOUNT} ETH.`);
    return;
  }

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

  const token0 = new Token(1, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6, "USDC", "USD Coin");
  const token1 = new Token(1, "0xC02aaa39b223FE8D0A0E5C4F27eAD9083C756Cc2", 18, "WETH", "Wrapped Ethereum");

  console.log('--- Fetching Pool Data ---');
  const poolData = await fetchPoolData(token0.address, token1.address);

  if (!poolData) {
    console.error('Failed to fetch pool data. Trade execution aborted.');
    return;
  }

  try {
    // Create Pool instance using fetched data
    const pool = new Pool(
      token0,
      token1,
      poolData.feeTier,
      poolData.sqrtPriceX96,
      poolData.liquidity,
      poolData.tick
    );

    // Determine trade route
    const route = new Route([pool], signal === 'Buy' ? token0 : token1, signal === 'Buy' ? token1 : token0);

    // Construct trade
    const trade = Trade.exactInput(
      CurrencyAmount.fromRawAmount(signal === 'Buy' ? token0 : token1, ethers.parseUnits(amount.toString(), 18)),
      route,
      TradeType.EXACT_INPUT
    );

    console.log(`Executing live ${signal} trade...`);
    console.log(`Route: ${JSON.stringify(route)}`);
    console.log(`Trade details: ${JSON.stringify(trade)}`);

    // Placeholder for actual trade execution
    console.log('Trade successfully simulated but not executed.');

    // Log trade results
    logTradeResult(signal, amount, 3422); // Replace with real price from API
  } catch (error) {
    console.error('Error executing trade:', error.message);
  }
}

function logTradeResult(signal, amount, priceAtSignal) {
  const filePath = '/home/techbu/OFA_Project_Local/ofa-project/logs/trade-log.json';
  const trade = {
    timestamp: new Date().toISOString(),
    signal,
    
