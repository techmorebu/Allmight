// arbitrumFetcher.js
// Arbitrum mainnet fetcher — Uniswap V3 + Camelot V2 + Camelot V3 (Algebra)
// Hardened speed-template version with success/partial/error status semantics

'use strict';
require('dotenv').config();

const { ethers } = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

const rpc = createProvider('arbitrum');

const CHAIN_ID = 'arbitrum';
const CHAIN_NUM = 42161;
const FETCH_CONCURRENCY = Math.max(
  1,
  Number(process.env.ARBITRUM_FETCHER_CONCURRENCY || 4)
);

const POOL_ABI_V3 = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
];

const PAIR_ABI_V2 = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];

// Algebra (Camelot V3) ABI — uses globalState() instead of slot0().
// sqrtPriceX96 is at index 0, feeZto (dynamic token0->token1 fee) at index 2.
const POOL_ABI_ALGEBRA = [
  'function globalState() external view returns (uint160 price, int24 tick, uint16 feeZto, uint16 feeOtz, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)',
  'function liquidity() external view returns (uint128)',
];

const UNISWAP_V3_POOLS = [
  // ── Phase 1 Re-entry (2026-03-18) ────────────────────────────────────────
  // Validated via arb_pool_smoke_test.js before re-entry.
  // Root cause of prior removal: Ethereum mainnet token0/token1 sort assumptions
  // were applied to Arbitrum pools. On Arbitrum, WETH (0x82aF..) sorts LOWER
  // than USDC (0xaf88..) — opposite of mainnet — so token0=WETH, token1=USDC.
  // All three pools confirmed live with slot0+liquidity responding and sane pricing.
  //
  // IMPORTANT: decimals0/decimals1 reflect ACTUAL on-chain token0/token1 ordering.
  // priceMode: 'direct' → price = sqrtP^2 × 10^(dec0-dec1)
  //   ETH/USDC direct: USDC per WETH → ~$2300 ✓
  //   ETH/USDT direct: USDT per WETH → ~$2300 ✓
  //   USDC/USDT direct: USDT per USDC → ~1.000 ✓
  //
  // sanityMin/sanityMax: per-pool price guard — catches silent wrong-pricing
  // if token ordering is ever misconfigured again.

  // ETH/USDC — on-chain token0=WETH (18dec), token1=USDC (6dec)
  {
    outputPair: 'ETH/USDC',
    pool:       '0xC6962004f452bE9203591991D15f6b388e09E8D0',
    decimals0:  18,
    decimals1:  6,
    fee:        500,
    priceMode:  'direct',
    sanityMin:  500,
    sanityMax:  20000,
  },

  // ETH/USDT — on-chain token0=WETH (18dec), token1=USDT (6dec)
  {
    outputPair: 'ETH/USDT',
    pool:       '0x641C00A822e8b671738d32a431a4Fb6074E5c79d',
    decimals0:  18,
    decimals1:  6,
    fee:        500,
    priceMode:  'direct',
    sanityMin:  500,
    sanityMax:  20000,
  },

  // USDC/USDT — on-chain token0=USDC (6dec), token1=USDT (6dec)
  {
    outputPair: 'USDC/USDT',
    pool:       '0xbE3aD6a5669Dc0B8b12FeBC03608860C31E2eef6',
    decimals0:  6,
    decimals1:  6,
    fee:        100,
    priceMode:  'direct',
    sanityMin:  0.9,
    sanityMax:  1.1,
  },

  // ── Phase 2A Addition (2026-03-18) ───────────────────────────────────────
  // Validated via arb_pool_smoke_test_p2.js before re-entry.
  // Both pools confirmed live with slot0+liquidity responding and sane pricing.
  // expectedToken0/expectedToken1 are stored for future runtime cross-check tooling.

  // ARB/WETH — on-chain token0=WETH (18dec), token1=ARB (18dec)
  // priceMode 'invert' → WETH per ARB ≈ 0.000046
  // Purpose: enables synthetic ARB/USD via ARB/WETH × ETH/USD legs
  {
    outputPair:     'ARB/WETH',
    pool:           '0xc6f780497a95e246eb9449f5e4770916dcd6396a',
    decimals0:      18,
    decimals1:      18,
    fee:            500,
    priceMode:      'invert',
    sanityMin:      0.000005,
    sanityMax:      0.01,
    expectedToken0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH
    expectedToken1: '0x912CE59144191C1204E64559FE8253a0e49E6548',  // ARB
  },

  // WBTC/USDT — on-chain token0=WBTC (8dec), token1=USDT (6dec)
  // priceMode 'direct' → USDT per WBTC ≈ $70k-$90k
  // Token ordering SAME as Ethereum mainnet — no chain-specific surprise
  {
    outputPair:     'WBTC/USDT',
    pool:           '0x5969efdde3cf5c0d9a88ae51e47d721096a97203',
    decimals0:      8,
    decimals1:      6,
    fee:            500,
    priceMode:      'direct',
    sanityMin:      20000,
    sanityMax:      100000,
    expectedToken0: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',  // WBTC
    expectedToken1: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',  // USDT
  },

  // ── Phase 3 Addition (2026-03-19) ────────────────────────────────────────
  // WBTC/WETH — validated via on-chain smoke test.
  // token0=WBTC, token1=WETH — same ordering as Ethereum mainnet.
  // Purpose: enables synthetic WBTC/USD via WBTC/WETH × ETH/USDC
  //          to compare against existing WBTC/USDT direct leg.
  // Single-read estimate: spread ~0.14%, fee ~0.10%, net ~+0.04%.
  // First surface showing potential fee-positive signal — requires persistence test.

  // WBTC/WETH — on-chain token0=WBTC (8dec), token1=WETH (18dec)
  // priceMode 'direct' → WETH per WBTC ≈ 32.4 ETH/BTC
  {
    outputPair:     'WBTC/WETH',
    pool:           '0x2f5e87c9312fa29aed5c179e456625d79015299c',
    decimals0:      8,
    decimals1:      18,
    fee:            500,
    priceMode:      'direct',
    sanityMin:      5,
    sanityMax:      200,
    expectedToken0: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',  // WBTC
    expectedToken1: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH
  },

  // ── Phase 2B Addition (2026-03-19) ───────────────────────────────────────
  // ARB/nativeUSDC — validated via factory query + on-chain smoke test.
  // token1 confirmed as Circle native USDC (0xaf88..), NOT USDCe (0xFF97..).
  // Factory: getPool(ARB, nativeUSDC, 500) = 0xb0f6cA40...
  // Purpose: direct ARB/USD surface for comparison against synthetic
  //          ARB/WETH x ETH/USDC and ARB/WETH x ETH/USDT legs.
  // Single-read direct-vs-synthetic gap observed ~1.1% — warrants persistence test.

  // ARB/USDC — on-chain token0=ARB (18dec), token1=nativeUSDC (6dec)
  {
    outputPair:     "ARB/USDC",
    pool:           "0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8",
    decimals0:      18,
    decimals1:      6,
    fee:            500,
    priceMode:      "direct",
    sanityMin:      0.01,
    sanityMax:      20,
    expectedToken0: "0x912CE59144191C1204E64559FE8253a0e49E6548",  // ARB
    expectedToken1: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",  // native USDC
  },

  // ── Phase 4 Addition (2026-04-02) ────────────────────────────────────────
  // ETH/USDC 0.01% — PRIMARY surface target (Boss session 2026-04-02).
  // Counterpart to Camelot V3 ETH/USDC below. Both validated via pool smoke test.
  // token0=WETH (0x82aF..) sorts LOWER than USDC (0xaf88..) on Arbitrum — same ordering
  // as existing 0.05% ETH/USDC pool above. decimals0=18 (WETH), decimals1=6 (USDC).
  // fee: 100/1e6 = 0.01%. sanityMin/Max same range as the 0.05% pool.
  {
    outputPair:     'ETH/USDC',
    pool:           '0x6f38e884725a116C9C7fBF208e79FE8828a2595F',
    decimals0:      18,
    decimals1:      6,
    fee:            100,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    expectedToken0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH
    expectedToken1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
  },

  // ── Phase 5 Addition (2026-04-02) — Inventory Breadth Expansion ─────────
  // Boss directive: expand discovery surface area across fee tiers and new pairs.
  // All pools validated via multi_pair_pool_discovery.js (block 448356222).
  // Cross-fee-tier arbitrage approved as SECONDARY class (Boss ruling 2026-04-02).
  //
  // Token ordering notes (Arbitrum mainnet sort order):
  //   WETH  0x82aF < USDC  0xaf88 < USDT  0xFd08 → WETH=t0, USDC=t0, etc.
  //   WBTC  0x2f2a < USDC  0xaf88 < USDT  0xFd08 → WBTC=t0 for both USDC/USDT pairs
  //   USDC  0xaf88 < DAI   0xDA10         → USDC=t0, DAI=t1  (price = DAI per USDC ≈ 1.0)
  //   USDC  0xaf88 < GMX   0xfc5A         → USDC=t0, GMX=t1  (priceMode=invert → USD per GMX)
  //   USDC  0xaf88 < UNI   0xFa7F         → USDC=t0, UNI=t1  (priceMode=invert → USD per UNI)

  // ETH/USDC 0.30% — cross-tier with existing 0.05% and 0.01%
  // depth≈$28M  token0=WETH(18dec), token1=USDC(6dec)
  {
    outputPair:     'ETH/USDC',
    pool:           '0xc473e2aEE3441BF9240Be85eb122aBB059A3B57c',
    decimals0:      18,
    decimals1:      6,
    fee:            3000,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    expectedToken0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH
    expectedToken1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
  },

  // ETH/USDT 0.01% — lower-fee cross-tier with existing 0.05%
  // depth≈$36.5k  token0=WETH(18dec), token1=USDT(6dec)
  {
    outputPair:     'ETH/USDT',
    pool:           '0x42161084d0672e1d3F26a9B53E653bE2084ff19C',
    decimals0:      18,
    decimals1:      6,
    fee:            100,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    expectedToken0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH
    expectedToken1: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',  // USDT
  },

  // ETH/USDT 0.30% — cross-tier with existing 0.05%
  // depth≈$3.2M  token0=WETH(18dec), token1=USDT(6dec)
  {
    outputPair:     'ETH/USDT',
    pool:           '0xc82819F72A9e77E2c0c3A69B3196478f44303cf4',
    decimals0:      18,
    decimals1:      6,
    fee:            3000,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    expectedToken0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH
    expectedToken1: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',  // USDT
  },

  // WBTC/USDC 0.05% — new pair (not previously in fetcher)
  // depth≈$105M  token0=WBTC(8dec), token1=native USDC(6dec)
  {
    outputPair:     'WBTC/USDC',
    pool:           '0x0E4831319A50228B9e450861297aB92dee15B44F',
    decimals0:      8,
    decimals1:      6,
    fee:            500,
    priceMode:      'direct',
    sanityMin:      10000,
    sanityMax:      100000,
    expectedToken0: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',  // WBTC
    expectedToken1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
  },

  // WBTC/USDC 0.30% — cross-tier with 0.05%
  // depth≈$3.1M  token0=WBTC(8dec), token1=native USDC(6dec)
  {
    outputPair:     'WBTC/USDC',
    pool:           '0x6985cb98CE393FCE8d6272127F39013f61e36166',
    decimals0:      8,
    decimals1:      6,
    fee:            3000,
    priceMode:      'direct',
    sanityMin:      10000,
    sanityMax:      100000,
    expectedToken0: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',  // WBTC
    expectedToken1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
  },

  // WBTC/USDT 0.30% — cross-tier with existing 0.05%
  // depth≈$983k  token0=WBTC(8dec), token1=USDT(6dec)
  {
    outputPair:     'WBTC/USDT',
    pool:           '0x53C6ca2597711Ca7a73b6921fAf4031EeDf71339',
    decimals0:      8,
    decimals1:      6,
    fee:            3000,
    priceMode:      'direct',
    sanityMin:      10000,
    sanityMax:      100000,
    expectedToken0: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',  // WBTC
    expectedToken1: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',  // USDT
  },

  // DAI/USDC 0.01% — new stable-vs-stable pair
  // depth≈$3.1B  token0=native USDC(6dec), token1=DAI(18dec)
  // NOTE: token0=USDC (sorts lower 0xaf88 < 0xDA10). Price ≈ DAI per USDC ≈ 1.0.
  // priceMode='direct': sqrtP^2 × 10^(6-18) = DAI per USDC ≈ 0.9999
  {
    outputPair:     'DAI/USDC',
    pool:           '0x7CF803e8d82A50504180f417B8bC7a493C0a0503',
    decimals0:      6,
    decimals1:      18,
    fee:            100,
    priceMode:      'direct',
    sanityMin:      0.9,
    sanityMax:      1.1,
    expectedToken0: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC (token0 — sorts lower)
    expectedToken1: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',  // DAI
  },

  // DAI/USDC 0.30% — cross-tier with 0.01%
  // depth≈$41.5k  token0=native USDC(6dec), token1=DAI(18dec)
  {
    outputPair:     'DAI/USDC',
    pool:           '0xD46c8A1940113ae64f960B7aA12EF5dcAB0ffe0E',
    decimals0:      6,
    decimals1:      18,
    fee:            3000,
    priceMode:      'direct',
    sanityMin:      0.9,
    sanityMax:      1.1,
    expectedToken0: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
    expectedToken1: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',  // DAI
  },

  // GMX/USDC 0.30% — Arbitrum-native major (Boss approved: single-venue ≥$25k)
  // depth≈$38.2k  token0=native USDC(6dec), token1=GMX(18dec)
  // NOTE: USDC(0xaf88) sorts lower than GMX(0xfc5A) → token0=USDC, token1=GMX.
  // priceMode='invert': 1/(GMX per USDC) = USDC per GMX ≈ $6.27
  {
    outputPair:     'GMX/USDC',
    pool:           '0x135E49cC315fED87F989e072ee11132686CF84F3',
    decimals0:      6,
    decimals1:      18,
    fee:            3000,
    priceMode:      'invert',
    sanityMin:      1,
    sanityMax:      500,
    expectedToken0: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
    expectedToken1: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a',  // GMX
  },

  // UNI/USDC 0.30% — low priority (Boss approved: single-venue ≥$25k)
  // depth≈$100.6k  token0=native USDC(6dec), token1=UNI(18dec)
  // NOTE: USDC(0xaf88) sorts lower than UNI(0xFa7F) → token0=USDC, token1=UNI.
  // priceMode='invert': 1/(UNI per USDC) = USDC per UNI ≈ $3.15
  {
    outputPair:     'UNI/USDC',
    pool:           '0x05477c22a5349ceE601500Da0489daD137fd6BfA',
    decimals0:      6,
    decimals1:      18,
    fee:            3000,
    priceMode:      'invert',
    sanityMin:      0.5,
    sanityMax:      100,
    expectedToken0: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
    expectedToken1: '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0',  // UNI
  },

  // ── Deferred pools ────────────────────────────────────────────────────────
  // ARB/USDCe  0xcda53b1f... — DEFERRED: quote asset is USDCe (bridged/deprecated).
  //   Identity confirmed by factory query 2026-03-19. Not native USDC.

  // ── Permanently retired pools (confirmed non-recoverable) ─────────────────
  // USDC/USDCe 0xfe8e29...  — CALL_EXCEPTION, USDCe deprecated
  // USDC/USDCe 0xA9E9CB...  — CALL_EXCEPTION, USDCe deprecated
  // USDC/USDT  0xbcE73c...  — dead, superseded by 0.01% pool above
  // DAI/USDT   0x7f580f...  — CALL_EXCEPTION
];

const CAMELOT_POOLS = [
  { outputPair: 'ETH/USDC', pool: '0x84652bb2539513BAf36e225c930Fdd8eaa63CE27', decimals0: 18, decimals1: 6, fee: 0.003, priceMode: 'direct' },
];

// Camelot V3 (Algebra) pools — use fetchCamelotV3Pool(), NOT fetchUniV3Pool().
// fee field = dynamic feeZto in millionths (249 = 0.0249%).
const CAMELOT_V3_POOLS = [
  // ARB/USDC — token0=ARB (18dec), token1=nativeUSDC (6dec)
  // Dynamic fee: 249/1e6 = 0.0249%. Native USDC confirmed.
  // Round-trip with UniV3 ARB/USDC: 0.0249% + 0.05% = 0.075%.
  {
    outputPair:     'ARB/USDC',
    pool:           '0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1',
    decimals0:      18,
    decimals1:      6,
    priceMode:      'direct',
    sanityMin:      0.01,
    sanityMax:      20,
    expectedToken0: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    expectedToken1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },

  // ETH/USDC — token0=WETH (18dec), token1=nativeUSDC (6dec)
  // Primary surface target (Boss session 2026-04-02). Paired with UniV3 ETH/USDC 0.01%.
  // token0=WETH (0x82aF..) confirmed lower sort order than USDC (0xaf88..) on Arbitrum.
  // Dynamic fee read live from globalState() index 2 (feeZto). Fallback: 0.01%.
  {
    outputPair:     'ETH/USDC',
    pool:           '0xB1026b8e7276e7AC75410F1fcbbe21796e8f7526',
    decimals0:      18,
    decimals1:      6,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    expectedToken0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH
    expectedToken1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
  },

  // ── Phase 5 Camelot V3 additions (2026-04-03) ────────────────────────────
  // Factory address corrected: 0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B
  // (prior address 0x1a3c9B...5E6 was wrong — confirmed via pool.factory() call)
  // Pools confirmed via poolByPair() on corrected factory.

  // ETH/USDT — token0=WETH (18dec), token1=USDT (6dec)
  // Confirmed: poolByPair(WETH, USDT) → 0x7CcCBA...
  {
    outputPair:     'ETH/USDT',
    pool:           '0x7CcCBA38E2D959fe135e79AEBB57CCb27B128358',
    decimals0:      18,
    decimals1:      6,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    expectedToken0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH
    expectedToken1: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',  // USDT
  },

  // WBTC/USDC — token0=WBTC (8dec), token1=nativeUSDC (6dec)
  // Confirmed: poolByPair(WBTC, USDC) → 0x02bE4f...
  {
    outputPair:     'WBTC/USDC',
    pool:           '0x02bE4f98FC9Ee4F612a139D84494CBf6c6c7F97f',
    decimals0:      8,
    decimals1:      6,
    priceMode:      'direct',
    sanityMin:      10000,
    sanityMax:      100000,
    expectedToken0: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',  // WBTC
    expectedToken1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
  },
];

// ─── SUSHISWAP V3 POOLS ───────────────────────────────────────────────────────
// SushiSwap V3 uses identical slot0() + liquidity() interface as UniV3.
// These are fetched via fetchUniV3Pool() with venue/source overrides in cfg.
// Factory: 0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e (confirmed Arbiscan 2026-03-28)
// All pools confirmed live via direct factory.getPool() call (2026-04-03).
// Token ordering matches Arbitrum sort (same rules as UniV3 pools above).
const SUSHISWAP_V3_POOLS = [
  // ETH/USDC 0.05% — cross-venue with UniV3 and Camelot V3
  {
    outputPair:     'ETH/USDC',
    pool:           '0xf3Eb87C1F6020982173C908E7eB31aA66c1f0296',
    decimals0:      18,
    decimals1:      6,
    fee:            500,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    venue:          'sushiswap_v3',
    source:         'sushiswap_v3_arbitrum_onchain',
    expectedToken0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH
    expectedToken1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
  },
  // ETH/USDC 0.30%
  {
    outputPair:     'ETH/USDC',
    pool:           '0xC96525298419f7E00dA8826B733Ee52e271662b5',
    decimals0:      18,
    decimals1:      6,
    fee:            3000,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    venue:          'sushiswap_v3',
    source:         'sushiswap_v3_arbitrum_onchain',
    expectedToken0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH
    expectedToken1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
  },
  // ETH/USDT 0.05%
  {
    outputPair:     'ETH/USDT',
    pool:           '0x96aDA81328abCe21939A51D971A63077e16db26E',
    decimals0:      18,
    decimals1:      6,
    fee:            500,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    venue:          'sushiswap_v3',
    source:         'sushiswap_v3_arbitrum_onchain',
    expectedToken0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH
    expectedToken1: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',  // USDT
  },
  // ETH/USDT 0.30%
  {
    outputPair:     'ETH/USDT',
    pool:           '0x92d543A8a158A6bC2C7018ae17803819Cb9150B2',
    decimals0:      18,
    decimals1:      6,
    fee:            3000,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    venue:          'sushiswap_v3',
    source:         'sushiswap_v3_arbitrum_onchain',
    expectedToken0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH
    expectedToken1: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',  // USDT
  },
  // WBTC/USDC 0.05%
  {
    outputPair:     'WBTC/USDC',
    pool:           '0x699f628A8A1DE0f28cf9181C1F8ED848eBB0BBdF',
    decimals0:      8,
    decimals1:      6,
    fee:            500,
    priceMode:      'direct',
    sanityMin:      10000,
    sanityMax:      100000,
    venue:          'sushiswap_v3',
    source:         'sushiswap_v3_arbitrum_onchain',
    expectedToken0: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',  // WBTC
    expectedToken1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
  },
  // WBTC/USDT 0.05%
  {
    outputPair:     'WBTC/USDT',
    pool:           '0xafAdBa8A2a51654987cDC385bD302443c461679e',
    decimals0:      8,
    decimals1:      6,
    fee:            500,
    priceMode:      'direct',
    sanityMin:      10000,
    sanityMax:      100000,
    venue:          'sushiswap_v3',
    source:         'sushiswap_v3_arbitrum_onchain',
    expectedToken0: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',  // WBTC
    expectedToken1: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',  // USDT
  },
  // ARB/USDC 0.05%
  {
    outputPair:     'ARB/USDC',
    pool:           '0xfa1cC0caE7779B214B1112322A2d1Cf0B511C3bC',
    decimals0:      18,
    decimals1:      6,
    fee:            500,
    priceMode:      'direct',
    sanityMin:      0.01,
    sanityMax:      20,
    venue:          'sushiswap_v3',
    source:         'sushiswap_v3_arbitrum_onchain',
    expectedToken0: '0x912CE59144191C1204E64559FE8253a0e49E6548',  // ARB
    expectedToken1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
  },
  // ARB/USDC 0.30%
  {
    outputPair:     'ARB/USDC',
    pool:           '0x14716A16ef9eeAaDa7E266bcF023b71D2c9ADbf3',
    decimals0:      18,
    decimals1:      6,
    fee:            3000,
    priceMode:      'direct',
    sanityMin:      0.01,
    sanityMax:      20,
    venue:          'sushiswap_v3',
    source:         'sushiswap_v3_arbitrum_onchain',
    expectedToken0: '0x912CE59144191C1204E64559FE8253a0e49E6548',  // ARB
    expectedToken1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
  },
];

function nowIso() {
  return new Date().toISOString();
}

function sqrtPriceX96ToPrice(sqrtPriceX96Raw, dec0, dec1, mode) {
  const Q96 = 2n ** 96n;
  const sqrtP = Number(sqrtPriceX96Raw) / Number(Q96);
  const raw = sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
  return mode === 'invert' ? 1 / raw : raw;
}

async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let idx = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const cur = idx++;
      if (cur >= items.length) break;
      out[cur] = await worker(items[cur], cur);
    }
  });

  await Promise.all(runners);
  return out;
}

async function fetchUniV3Pool(cfg, blockNumber) {
  try {
    const { result, meta } = await rpc.callDetailed(
      `arb.univ3.${cfg.outputPair}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const c = new ethers.Contract(cfg.pool, POOL_ABI_V3, provider);
        const [slot0, liq] = await Promise.all([
          c.slot0({ blockTag: blockNumber }),
          c.liquidity({ blockTag: blockNumber }),
        ]);
        return { slot0, liq };
      },
      { timeoutMs: cfg.timeoutMs || 4000, hedge: true }
    );

    const price = sqrtPriceX96ToPrice(
      result.slot0[0],
      cfg.decimals0,
      cfg.decimals1,
      cfg.priceMode
    );

    if (!isFinite(price) || price <= 0 || price > 1e15) {
      throw new Error(`invalid price ${price}`);
    }

    // Per-pool sanity guard (Boss directive 2026-03-18):
    // Catches silent wrong-pricing from token order misconfig before it
    // reaches Redis. sanityMin/sanityMax are set per pool at config entry.
    if (cfg.sanityMin !== undefined && cfg.sanityMax !== undefined) {
      if (price < cfg.sanityMin || price > cfg.sanityMax) {
        throw new Error(
          `[TOKEN-ORDER-GUARD] price ${price.toFixed(4)} outside expected range ` +
          `[${cfg.sanityMin}, ${cfg.sanityMax}] for ${cfg.outputPair} — ` +
          `check decimals0/decimals1 and priceMode against on-chain token0/token1`
        );
      }
    }

    // Legacy stable-pair fallback guard (pools without explicit sanity bounds)
    const isStable = !cfg.outputPair.includes('ETH') && !cfg.outputPair.includes('BTC');
    if (isStable && cfg.sanityMin === undefined && (price < 0.9 || price > 1.1)) {
      throw new Error(`stable price out of range ${price}`);
    }

    const liqNum = Number(result.liq);
    const liquidityRaw = result.liq.toString();

    return {
      ok: true,
      price: {
        pair: cfg.outputPair,
        pool: cfg.pool,
        price,
        liquidity: liqNum,
        liquidityRaw,
        tvlUSD: null,
        fee: cfg.fee / 1_000_000,
        tick: Number(result.slot0[1]),
        source: cfg.source || 'uniswap_v3_arbitrum_onchain',
        venue: cfg.venue || 'uniswap_v3',
        chain: CHAIN_ID,
        blockNumber,
        endpointId: meta.endpointId,
        endpoint: meta.urlRedacted,
        timestamp: nowIso(),
      },
    };
  } catch (e) {
    return {
      ok: false,
      venue: cfg.venue || 'uniswap_v3',
      pair: cfg.outputPair,
      pool: cfg.pool,
      error: String(e.message || e).slice(0, 160),
    };
  }
}

async function fetchCamelotPool(cfg, blockNumber) {
  try {
    const { result, meta } = await rpc.callDetailed(
      `arb.camelot.${cfg.outputPair}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const c = new ethers.Contract(cfg.pool, PAIR_ABI_V2, provider);
        const reserves = await c.getReserves({ blockTag: blockNumber });
        return { reserves };
      },
      { timeoutMs: 4000, hedge: true }
    );

    const r0b = result.reserves[0];
    const r1b = result.reserves[1];

    if (r0b === 0n || r1b === 0n) {
      throw new Error('zero reserves');
    }

    const PREC = 1000000000n;
    const SCALE0 = BigInt('1' + '0'.repeat(cfg.decimals0));
    const SCALE1 = BigInt('1' + '0'.repeat(cfg.decimals1));
    const adj0 = Number((r0b * PREC) / SCALE0) / 1e9;
    const adj1 = Number((r1b * PREC) / SCALE1) / 1e9;

    if (!adj0 || !adj1) {
      throw new Error('adjusted reserves invalid');
    }

    const raw = adj1 / adj0;
    const price = cfg.priceMode === 'invert' ? 1 / raw : raw;

    if (!isFinite(price) || price <= 0 || price > 1e12) {
      throw new Error(`invalid price ${price}`);
    }

    const reserveUSD = cfg.outputPair === 'ETH/USDC'
      ? adj1 * 2
      : adj1 * price * 2;

    return {
      ok: true,
      price: {
        pair: cfg.outputPair,
        pool: cfg.pool,
        price,
        reserve0: r0b.toString(),
        reserve1: r1b.toString(),
        reserveUSD,
        fee: cfg.fee,
        source: 'camelot_v2_arbitrum_onchain',
        venue: 'camelot_v2',
        chain: CHAIN_ID,
        blockNumber,
        endpointId: meta.endpointId,
        endpoint: meta.urlRedacted,
        timestamp: nowIso(),
      },
    };
  } catch (e) {
    return {
      ok: false,
      venue: 'camelot_v2',
      pair: cfg.outputPair,
      pool: cfg.pool,
      error: String(e.message || e).slice(0, 160),
    };
  }
}

// Algebra (Camelot V3) pool fetcher — separate from UniV3.
// Uses globalState() to get sqrtPriceX96 and dynamic feeZto.
// Math after extraction is identical to fetchUniV3Pool.
async function fetchCamelotV3Pool(cfg, blockNumber) {
  try {
    const { result, meta } = await rpc.callDetailed(
      `arb.camelotv3.${cfg.outputPair.replace('/','_')}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const c = new ethers.Contract(cfg.pool, POOL_ABI_ALGEBRA, provider);
        const [gs, liq] = await Promise.all([
          c.globalState({ blockTag: blockNumber }),
          c.liquidity({ blockTag: blockNumber }),
        ]);
        return { gs, liq };
      },
      { timeoutMs: 4000, hedge: true }
    );

    const sqrtPriceX96 = result.gs[0];
    const feeZto       = Number(result.gs[2]);

    const price = sqrtPriceX96ToPrice(sqrtPriceX96, cfg.decimals0, cfg.decimals1, cfg.priceMode);

    if (!isFinite(price) || price <= 0 || price > 1e15) {
      throw new Error(`invalid price ${price}`);
    }

    // TOKEN-ORDER-GUARD — same discipline as UniV3
    if (cfg.sanityMin !== undefined && cfg.sanityMax !== undefined) {
      if (price < cfg.sanityMin || price > cfg.sanityMax) {
        throw new Error(
          `[TOKEN-ORDER-GUARD] price ${price.toFixed(4)} outside expected range ` +
          `[${cfg.sanityMin}, ${cfg.sanityMax}] for ${cfg.outputPair}`
        );
      }
    }

    return {
      ok: true,
      price: {
        pair:         cfg.outputPair,
        pool:         cfg.pool,
        price,
        liquidity:    Number(result.liq),
        liquidityRaw: result.liq.toString(),
        tvlUSD:       null,
        fee:          feeZto / 1_000_000,
        tick:         Number(result.gs[1]),
        source:       'camelot_v3_arbitrum_onchain',
        venue:        'camelot_v3',
        chain:        CHAIN_ID,
        blockNumber,
        endpointId:   meta.endpointId,
        endpoint:     meta.urlRedacted,
        timestamp:    nowIso(),
      },
    };
  } catch (e) {
    return { ok: false, venue: 'camelot_v3', pair: cfg.outputPair, pool: cfg.pool, error: String(e.message || e).slice(0, 160) };
  }
}

async function arbitrumFetcher() {
  const startedAt = Date.now();
  const startedIso = nowIso();

  let blockNumber = null;
  let blockMeta = null;

  try {
    const blockResp = await rpc.getBlockNumber(
      'arbitrum.fetcher.block',
      { timeoutMs: 1200, hedge: true }
    );
    blockNumber = blockResp.blockNumber;
    blockMeta = blockResp.meta;
  } catch (e) {
    return {
      status: 'error',
      partial: false,
      data: {
        prices: [],
        chain: CHAIN_ID,
        chain_id: CHAIN_NUM,
        venues: ['uniswap_v3', 'sushiswap_v3', 'camelot_v2', 'camelot_v3'],
        timestamp: startedIso,
        durationMs: Date.now() - startedAt,
        blockNumber: null,
        fetchConcurrency: FETCH_CONCURRENCY,
        endpointId: null,
        endpoint: null,
        endpointIdsSeen: [],
        endpointsSeen: [],
        stats: {
          totalPools: UNISWAP_V3_POOLS.length + SUSHISWAP_V3_POOLS.length + CAMELOT_POOLS.length + CAMELOT_V3_POOLS.length,
          successCount: 0,
          failureCount: UNISWAP_V3_POOLS.length + SUSHISWAP_V3_POOLS.length + CAMELOT_POOLS.length + CAMELOT_V3_POOLS.length,
          uniswapV3: {
            total: UNISWAP_V3_POOLS.length,
            success: 0,
            failed: UNISWAP_V3_POOLS.length,
          },
          sushiswapV3: {
            total: SUSHISWAP_V3_POOLS.length,
            success: 0,
            failed: SUSHISWAP_V3_POOLS.length,
          },
          camelot: {
            total: CAMELOT_POOLS.length,
            success: 0,
            failed: CAMELOT_POOLS.length,
          },
          camelotV3: {
            total: CAMELOT_V3_POOLS.length,
            success: 0,
            failed: CAMELOT_V3_POOLS.length,
          },
        },
        failures: [
          {
            venue: 'block_fetch',
            pair: 'n/a',
            pool: 'n/a',
            error: String(e.message || e).slice(0, 160),
          },
        ],
      },
    };
  }

  const uniResults = await mapWithConcurrency(
    UNISWAP_V3_POOLS,
    FETCH_CONCURRENCY,
    (cfg) => fetchUniV3Pool(cfg, blockNumber)
  );

  const sushiResults = await mapWithConcurrency(
    SUSHISWAP_V3_POOLS,
    FETCH_CONCURRENCY,
    (cfg) => fetchUniV3Pool(cfg, blockNumber)  // identical interface — venue/source come from cfg
  );

  const camelotResults = await mapWithConcurrency(
    CAMELOT_POOLS,
    FETCH_CONCURRENCY,
    (cfg) => fetchCamelotPool(cfg, blockNumber)
  );

  const camelotV3Results = await mapWithConcurrency(
    CAMELOT_V3_POOLS,
    FETCH_CONCURRENCY,
    (cfg) => fetchCamelotV3Pool(cfg, blockNumber)
  );

  const combined = [...uniResults, ...sushiResults, ...camelotResults, ...camelotV3Results];

  const priceRows = combined
    .filter((x) => x && x.ok && x.price)
    .map((x) => x.price);

  const failures = combined
    .filter((x) => !x || !x.ok)
    .map((x) => ({
      venue: x?.venue || 'unknown',
      pair: x?.pair || 'unknown',
      pool: x?.pool || 'unknown',
      error: x?.error || 'unknown error',
    }));

  const durationMs = Date.now() - startedAt;
  const endpointIdsSeen = [...new Set(priceRows.map((p) => p.endpointId).filter((v) => v !== undefined))];
  const endpointsSeen = [...new Set(priceRows.map((p) => p.endpoint).filter(Boolean))];

  const successCount = priceRows.length;
  const failureCount = failures.length;

  const status =
    successCount === 0 ? 'error' :
    failureCount > 0 ? 'partial' :
    'success';

  return {
    status,
    partial: status === 'partial',
    data: {
      prices: priceRows,
      chain: CHAIN_ID,
      chain_id: CHAIN_NUM,
      venues: ['uniswap_v3', 'sushiswap_v3', 'camelot_v2', 'camelot_v3'],
      timestamp: startedIso,
      durationMs,
      blockNumber,
      fetchConcurrency: FETCH_CONCURRENCY,
      endpointId: blockMeta?.endpointId ?? null,
      endpoint: blockMeta?.urlRedacted ?? null,
      endpointIdsSeen,
      endpointsSeen,
      stats: {
        totalPools: UNISWAP_V3_POOLS.length + SUSHISWAP_V3_POOLS.length + CAMELOT_POOLS.length + CAMELOT_V3_POOLS.length,
        successCount,
        failureCount,
        uniswapV3: {
          total: UNISWAP_V3_POOLS.length,
          success: uniResults.filter((x) => x && x.ok).length,
          failed: uniResults.filter((x) => !x || !x.ok).length,
        },
        sushiswapV3: {
          total: SUSHISWAP_V3_POOLS.length,
          success: sushiResults.filter((x) => x && x.ok).length,
          failed: sushiResults.filter((x) => !x || !x.ok).length,
        },
        camelot: {
          total: CAMELOT_POOLS.length,
          success: camelotResults.filter((x) => x && x.ok).length,
          failed: camelotResults.filter((x) => !x || !x.ok).length,
        },
        camelotV3: {
          total: CAMELOT_V3_POOLS.length,
          success: camelotV3Results.filter((x) => x && x.ok).length,
          failed: camelotV3Results.filter((x) => !x || !x.ok).length,
        },
      },
      failures,
    },
  };
}

if (require.main === module) {
  arbitrumFetcher()
    .then((result) => {
      console.log('\nARBITRUM ON-CHAIN DATA:');
      console.log('='.repeat(90));
      console.log(
        `status=${result.status} partial=${result.partial} block=${result.data.blockNumber} endpoint=${result.data.endpoint} ` +
        `epSeen=${(result.data.endpointIdsSeen || []).join(',') || 'n/a'} ` +
        `duration=${result.data.durationMs}ms success=${result.data.stats.successCount} ` +
        `failed=${result.data.stats.failureCount}`
      );

      result.data.prices.forEach((p) => {
        const tvl = (p.tvlUSD || p.reserveUSD)
          ? `$${((p.tvlUSD || p.reserveUSD) / 1000).toFixed(1)}k`
          : 'n/a';
        const feePct = (p.fee * 100).toFixed(4) + '%';
        const px = p.price > 1 ? `$${p.price.toFixed(4)}` : p.price.toFixed(6);

        console.log(
          `${p.venue.padEnd(12)} ${p.pair.padEnd(14)} ${px.padStart(12)} | ` +
          `TVL: ${tvl.padStart(10)} | fee: ${feePct} | ep:${String(p.endpointId).padStart(2)}`
        );
      });

      if (result.data.failures.length) {
        console.log('-'.repeat(90));
        console.log('FAILURES:');
        result.data.failures.forEach((f) => {
          console.log(
            `${f.venue.padEnd(12)} ${String(f.pair).padEnd(14)} ${f.pool} :: ${f.error}`
          );
        });
      }

      console.log('='.repeat(90));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

arbitrumFetcher.chain = 'arbitrum';

module.exports = arbitrumFetcher;
