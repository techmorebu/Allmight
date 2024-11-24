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

  const token0 = new Token(1, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48".toLowerCase(), 6, "USDC", "USD Coin");
  const token1 = new Token(1, "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2".toLowerCase(), 18, "WETH", "Wrapped Ethereum");

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

// Main execution function
function main() {
  console.log(`--- Starting Trade Execution (${process.env.LIVE_FIRE === 'true' ? 'LIVE' : 'SIMULATION'} MODE) ---`);

  const signal = 'Buy'; // Example signal
  const tradeAmount = 1; // Example amount

  console.log(`Generated Signal: ${signal}`);
  console.log(`Trade Amount: ${tradeAmount} ETH`);

  if (process.env.LIVE_FIRE === 'true') {
    console.log('Executing in LIVE_FIRE mode...');
    executeLiveTrade(signal, tradeAmount);
  } else {
    console.log('Simulation mode. No live trade executed.');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Error in script execution:', error.message);
  }
}

module.exports = { executeLiveTrade };
