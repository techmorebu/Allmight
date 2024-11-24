const { generateSignals } = require('./signal-generator');
const fs = require('fs');
require('dotenv').config({ path: '/home/techbu/OFA_Project_Local/ofa-project/.env' });

const LIVE_FIRE = process.env.LIVE_FIRE === 'true';
const MAX_TRADE_AMOUNT = 10; // Maximum trade size in ETH

// Log trade results to a file
function logTradeResult(signal, amount, priceAtSignal) {
  const filePath = '/home/techbu/OFA_Project_Local/ofa-project/logs/trade-log.json';
  const trade = {
    timestamp: new Date().toISOString(),
    signal,
    amount,
    priceAtSignal,
  };

  let existingTrades = [];
  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      existingTrades = JSON.parse(fileContent);
    }

    existingTrades.push(trade);
    fs.writeFileSync(filePath, JSON.stringify(existingTrades, null, 2));
    console.log('Trade logged:', trade);
  } catch (error) {
    console.error('Error logging trade:', error.message);
  }
}

// Simulate trade execution
function simulateTrade(signal, amount = 1) {
  console.log('--- Simulated Trade Execution ---');
  if (signal === 'Buy') {
    console.log(`Simulating buy of ${amount} ETH.`);
  } else if (signal === 'Sell') {
    console.log(`Simulating sell of ${amount} ETH.`);
  } else {
    console.log('Simulating hold. No trade executed.');
  }
  logTradeResult(signal, amount, 3422); // Example ETH price at signal
}

// Execute a live trade
const { ethers } = require('ethers');
const { Token, CurrencyAmount, TradeType } = require('@uniswap/sdk-core');
const { Pool, Route, Trade } = require('@uniswap/v3-sdk');

async function executeLiveTrade(signal, amount = 1) {
  if (amount > MAX_TRADE_AMOUNT) {
    console.error(`Trade amount exceeds maximum limit of ${MAX_TRADE_AMOUNT} ETH.`);
    return;
  }

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const ethToken = new Token(1, ethers.ZeroAddress, 18, 'ETH', 'Ethereum');
  const usdcToken = new Token(1, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 6, 'USDC', 'USD Coin');
  
  console.log('--- Live Trade Execution ---');

  try {
    const pool = new Pool(
      ethToken,            // Token A
      usdcToken,           // Token B
      3000,                // Fee tier (Uniswap's 0.3%)
      '123456789',         // Mock sqrtPriceX96
      '1000000',           // Mock liquidity
      '1'                  // Tick spacing
    );

    const route = new Route([pool], signal === 'Buy' ? usdcToken : ethToken, signal === 'Buy' ? ethToken : usdcToken);
    const trade = Trade.exactInput(
      new CurrencyAmount(signal === 'Buy' ? usdcToken : ethToken, ethers.parseUnits(amount.toString(), 18)),
      route,
      TradeType.EXACT_INPUT
    );

    console.log(`Executing live ${signal} trade...`);
    console.log(`Route: ${JSON.stringify(route)}`);
    console.log(`Trade details: ${JSON.stringify(trade)}`);

    // Replace the following with actual trade execution logic:
    console.log('Trade successfully simulated but not executed.');

    // Log the trade result
    logTradeResult(signal, amount, 3422); // Replace with actual price
  } catch (error) {
    console.error('Error executing trade:', error.message);
  }
}

// Main function
function main() {
  console.log(`--- Starting Trade Execution (${LIVE_FIRE ? 'LIVE' : 'SIMULATION'} MODE) ---`);

  const trends = {
    avgPrice: 3000, // Replace with real trends from analysis
    priceChange: 2,
    avgPoolVolume: 5000000,
    avgLiquidity: 20000000,
  };

  // Generate signal
  const signalResult = generateSignals(trends);

  if (!signalResult || !signalResult.signal) {
    console.error('No valid signal generated.');
    return;
  }

  const { signal } = signalResult;
  const tradeAmount = 1; // Replace with dynamic amount if needed

  if (LIVE_FIRE) {
    executeLiveTrade(signal, tradeAmount);
  } else {
    simulateTrade(signal, tradeAmount);
  }
}

// Execute if script is run directly
if (require.main === module) {
  main();
}

module.exports = { simulateTrade, executeLiveTrade };
