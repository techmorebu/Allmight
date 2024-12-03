const { fetchPoolData } = require('./fetch-pool-data');
const { generateSignals } = require('./signal-generator');
const ethers = require('ethers');
require('dotenv').config();

async function executeLiveTrade(token0, token1) {
  console.log(`Querying pool for: ${token0} - ${token1}`);
  console.log('--- Starting Live Trade Execution ---');

  try {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_MAINNET_RPC_URL_1);
    const wallet = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider);

    console.log('Fetching Pool Data...');
    const poolData = await fetchPoolData(token0, token1);

    if (!poolData) {
      console.error('No valid pool data. Trade execution aborted.');
      return;
    }

    console.log('Fetched Pool Data:', poolData);

    const trends = {
      avgPrice: parseFloat(poolData.sqrtPriceX96) / 1e6, // Simplified
      avgPoolVolume: 1000000, // Mock data; replace with real volume
      avgLiquidity: parseFloat(poolData.liquidity),
    };

    const { signal } = generateSignals(trends);
    console.log(`Generated Signal: ${signal}`);

    const tradeAmount = ethers.utils.parseUnits('1', 18); // 1 ETH
    if (signal === 'Buy') {
      console.log(`Executing Buy of ${tradeAmount.toString()}...`);
      // Add trade execution logic here
    } else if (signal === 'Sell') {
      console.log(`Executing Sell of ${tradeAmount.toString()}...`);
      // Add trade execution logic here
    } else {
      console.log('Holding. No trade executed.');
    }

    console.log('--- Live Trade Execution Complete ---');
  } catch (error) {
    console.error('Error executing trade:', error.message);
  }
}

async function main() {
  // Define token pairs
  const pairs = [
    { token0: process.env.TOKEN_A_ADDRESS, token1: process.env.TOKEN_B_ADDRESS },
    { token0: '0x6b175474e89094c44da98b954eedeac495271d0f', token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' }, // Example pair DAI-WETH
  ];

  for (const pair of pairs) {
    await executeLiveTrade(pair.token0, pair.token1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { executeLiveTrade };
