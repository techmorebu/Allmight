// Enhanced Uniswap V3 Fetcher - Direct On-Chain Pool Queries (CONTROLLED RPC)
// v2.1 — added 500ms inter-pool sleep, batched slot0+liquidity into single rpc.call()
//
// Migration history:
//   v2.0 — createProvider('ethereum'), serial loop, chain tag, token_registry
//   v2.1 — FETCH_DELAY_MS sleep added, slot0+liquidity batched under one provider call
'use strict';

const { ethers }         = require('ethers');
const { getToken }       = require('../../../utils/token_registry');
const { createProvider } = require('../../../utils/provider_factory');

const CHAIN          = 'ethereum';
const FETCH_DELAY_MS = 500;  // conservative — Ethereum endpoints are rate-sensitive

const rpc = createProvider(CHAIN);

const UNISWAP_V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

const UNISWAP_V3_POOLS = [
  { name: 'ETH/USDC',  token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', pool: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', fee: 0.05 },
  { name: 'ETH/USDC',  token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', pool: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8', fee: 0.3  },
  { name: 'WBTC/ETH',  token0: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', pool: '0xCBCdF9626bC03E24f779434178A73a0B4bad62eD', fee: 0.3  },
  { name: 'USDC/USDT', token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', pool: '0x3416cF6C708Da44DB2624D63ea0AAef7113527C6', fee: 0.01 },
  { name: 'LINK/ETH',  token0: '0x514910771AF9Ca656af840dff83E8264EcF986CA', token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', pool: '0xa6Cc3C2531FdaA6Ae1A3CA84c2855806728693e8', fee: 0.3  },
  { name: 'UNI/ETH',   token0: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', pool: '0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801', fee: 0.3  },
  { name: 'AAVE/ETH',  token0: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', pool: '0x5aB53EE1d50eeF2C1DD3d5402789cd27bB52c1bB', fee: 0.3  },
  { name: 'MATIC/ETH', token0: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', pool: '0x290A6a7460B308ee3F19023D2D00dE604bcf5B42', fee: 0.3  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function calculatePrice(sqrtPriceX96, decimals0, decimals1) {
  // NOTE: Number() loses precision on large sqrtPriceX96. Acceptable for coarse monitoring.
  const sqrtPrice = Number(sqrtPriceX96.toString());
  const price     = (sqrtPrice * sqrtPrice) / (2 ** 192);
  return price * (10 ** (decimals0 - decimals1));
}

async function _erc20Meta(address) {
  // Token registry first — avoids RPC call for all known tokens
  const reg = getToken(CHAIN, address);
  if (reg && reg.decimals != null && reg.symbol) {
    return { decimals: reg.decimals, symbol: reg.symbol };
  }

  // Registry miss — controlled RPC fallback (should be rare)
  const decimals = await rpc.call(`erc20.decimals:${address.slice(0, 10)}`, async (provider) => {
    const token = new ethers.Contract(address, ERC20_ABI, provider);
    return token.decimals();
  });

  const symbol = await rpc.call(`erc20.symbol:${address.slice(0, 10)}`, async (provider) => {
    const token = new ethers.Contract(address, ERC20_ABI, provider);
    return token.symbol();
  });

  return { decimals: Number(decimals.toString()), symbol };
}

// ── Pool fetcher ──────────────────────────────────────────────────────────────

async function fetchPoolData(poolConfig) {
  // slot0 + liquidity: same contract, same provider, batched inside one rpc.call.
  // This is NOT cross-pool fan-out — two reads on one contract under one context.
  const [slot0, liquidity] = await rpc.call(
    `eth.univ3.${poolConfig.name.replace('/', '-')}.${poolConfig.pool.slice(0, 10)}`,
    async (provider) => {
      const pool = new ethers.Contract(poolConfig.pool, UNISWAP_V3_POOL_ABI, provider);
      return Promise.all([pool.slot0(), pool.liquidity()]);
    }
  );

  const [meta0, meta1] = await Promise.all([
    _erc20Meta(poolConfig.token0),
    _erc20Meta(poolConfig.token1),
  ]);

  const priceRaw = calculatePrice(slot0[0], meta0.decimals, meta1.decimals);
  const tvl      = Number(liquidity.toString()) / (10 ** meta0.decimals) * priceRaw;

  return {
    pair:       poolConfig.name,
    pool:       poolConfig.pool,
    price:      poolConfig.name === 'ETH/USDC' ? (1 / priceRaw) : priceRaw,
    liquidity:  liquidity.toString(),
    reserveUSD: tvl,
    fee:        poolConfig.fee,
    source:     'uniswap_v3_onchain',
    venue:      'uniswap_v3',
    chain:      CHAIN,
    timestamp:  new Date().toISOString(),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function fetchUniswapV3Data() {
  const started = Date.now();
  console.log('Fetching Uniswap V3 on-chain data (Ethereum mainnet)...');

  const prices = [];
  let ok = 0;

  // Serial with sleep — no cross-pool Promise.all burst
  for (const pool of UNISWAP_V3_POOLS) {
    try {
      const row = await fetchPoolData(pool);
      prices.push(row);
      ok += 1;
    } catch (e) {
      console.error(`[ETH-UNIV3] ${pool.name} ${pool.pool.slice(0, 10)}: ${e.message.slice(0, 80)}`);
      // Fault isolated per pool — continue
    }
    await sleep(FETCH_DELAY_MS);
  }

  console.log(`UniswapV3 Ethereum: ${ok}/${UNISWAP_V3_POOLS.length} pools in ${Date.now() - started}ms`);

  return {
    status: 'success',
    data: {
      prices,
      chain:      CHAIN,
      venues:     ['uniswap_v3'],
      timestamp:  new Date().toISOString(),
      durationMs: Date.now() - started,
      source:     'uniswap_v3_onchain',
      exchange:   'uniswap_v3',
    },
  };
}

fetchUniswapV3Data.chain = CHAIN;
module.exports = fetchUniswapV3Data;

if (require.main === module) {
  fetchUniswapV3Data().then(result => {
    console.log('\nUNISWAP V3 ETHEREUM DATA:');
    console.log('═'.repeat(70));
    result.data.prices.forEach(p => {
      const tvl = p.reserveUSD ? `$${(p.reserveUSD / 1e6).toFixed(1)}M` : 'n/a';
      console.log(
        `${p.pair.padEnd(15)} $${p.price.toFixed(6).padStart(12)} | TVL: ${tvl.padStart(8)} | Fee: ${p.fee}%`
      );
    });
    console.log('═'.repeat(70));
    console.log(`Total pools: ${result.data.prices.length}`);
  }).catch(console.error);
}
