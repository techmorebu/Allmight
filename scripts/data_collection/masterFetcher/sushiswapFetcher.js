'use strict';

/**
 * scripts/data_collection/masterFetcher/sushiswapFetcher.js
 *
 * Sushiswap V2 on-chain pool data fetcher — Ethereum mainnet.
 * Canonical provider layer + token registry first.
 */

const { ethers }         = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');
const { getToken }       = require('../../../utils/token_registry');

const CHAIN = 'ethereum';
const rpc   = createProvider(CHAIN);

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

const SUSHISWAP_POOLS = [
  {
    name:   'ETH/USDC',
    token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    pair:   '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0',
  },
  {
    name:   'WBTC/ETH',
    token0: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    pair:   '0xCEfF51756c56CeFFCA006cD410B03FFC46dd3a58',
  },
  {
    name:   'LINK/ETH',
    token0: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    pair:   '0xC40D16476380e4037e6b1A2594cAF6a6cc8Da967',
  },
  {
    name:   'UNI/ETH',
    token0: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    pair:   '0xDafd66636E2561b0284EDdE37e42d192F2844D40',
  },
  {
    name:   'AAVE/ETH',
    token0: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    pair:   '0xD75EA151a61d06868E31F8988D28DFE5E9df57B4',
  },
  {
    name:   'DAI/ETH',
    token0: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    pair:   '0xC3D03e4F041Fd4cD388c549Ee2A29a9E5075882f',
  },
];

function computePrice(poolName, reserve0Num, reserve1Num) {
  if (poolName === 'ETH/USDC')  return reserve0Num / reserve1Num;
  if (poolName === 'WBTC/ETH')  return reserve1Num / reserve0Num;
  if (poolName === 'USDC/USDT') return reserve1Num / reserve0Num;
  if (poolName === 'DAI/ETH')   return reserve0Num / reserve1Num;
  return reserve1Num / reserve0Num;
}

async function erc20Meta(address) {
  const reg = getToken(CHAIN, address);
  if (reg && reg.decimals != null && reg.symbol) {
    return {
      decimals: Number(reg.decimals),
      symbol: reg.symbol,
    };
  }

  const decimals = await rpc.call(`erc20.decimals:${address}`, async (provider) => {
    return new ethers.Contract(address, ERC20_ABI, provider).decimals();
  });

  const symbol = await rpc.call(`erc20.symbol:${address}`, async (provider) => {
    return new ethers.Contract(address, ERC20_ABI, provider).symbol();
  });

  return {
    decimals: Number(decimals.toString()),
    symbol,
  };
}

async function fetchPoolData(poolConfig) {
  try {
    const reserves = await rpc.call(
      `sushi.getReserves:${poolConfig.name}`,
      async (provider) => {
        const pair = new ethers.Contract(poolConfig.pair, PAIR_ABI, provider);
        return pair.getReserves();
      }
    );

    const [meta0, meta1] = await Promise.all([
      erc20Meta(poolConfig.token0),
      erc20Meta(poolConfig.token1),
    ]);

    const reserve0Num = Number(reserves[0].toString()) / Math.pow(10, meta0.decimals);
    const reserve1Num = Number(reserves[1].toString()) / Math.pow(10, meta1.decimals);
    const price       = computePrice(poolConfig.name, reserve0Num, reserve1Num);
    const tvl         = (reserve0Num * price) + reserve1Num;

    return {
      pair:       poolConfig.name,
      pool:       poolConfig.pair,
      price,
      reserve0:   reserves[0].toString(),
      reserve1:   reserves[1].toString(),
      reserveUSD: tvl,
      fee:        0.3,
      source:     'sushiswap_onchain',
      venue:      'sushiswap',
      chain:      CHAIN,
      timestamp:  new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[sushiswapFetcher] ${poolConfig.name}: ${error.message}`);
    return null;
  }
}

async function fetchSushiswapData() {
  console.log('[sushiswapFetcher] Fetching Sushiswap on-chain data...');

  try {
    const results = await Promise.all(SUSHISWAP_POOLS.map(fetchPoolData));
    const prices = results.filter(Boolean);

    console.log(`[sushiswapFetcher] ${prices.length}/${SUSHISWAP_POOLS.length} pools fetched`);

    return {
      status: 'success',
      data: {
        prices,
        chain: CHAIN,
        venues: ['sushiswap'],
        timestamp: new Date().toISOString(),
        source: 'sushiswap_onchain',
        exchange: 'sushiswap',
      },
    };
  } catch (error) {
    console.error('[sushiswapFetcher] Fatal error:', error.message);
    return {
      status: 'error',
      error: error.message,
      data: {
        prices: [],
        chain: CHAIN,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

fetchSushiswapData.chain = CHAIN;
module.exports = fetchSushiswapData;

if (require.main === module) {
  fetchSushiswapData()
    .then((result) => {
      console.log('\nSUSHISWAP ON-CHAIN DATA:');
      console.log('═'.repeat(70));
      result.data.prices.forEach((p) => {
        console.log(
          `${p.pair.padEnd(15)} $${p.price.toFixed(6).padStart(12)} | TVL: $${(p.reserveUSD / 1_000_000).toFixed(1)}M | Fee: ${p.fee}%`
        );
      });
      console.log('═'.repeat(70));
      console.log(`Total pools: ${result.data.prices.length}`);
    })
    .catch(console.error);
}
