// scripts/data_collection/masterFetcher/gasPriceOracle.js
// Ethereum gas price oracle — HTTP source aggregator
// Hardened oracle-class version with normalized envelope
//
// Migration history:
//   v1.0 — anonymous export, always-success status, no .chain tag, no failures envelope
//   v2.0 — named export, .chain tag, honest status, normalized envelope
//           (status/partial/stats/failures), hardcoded ETH price warning,
//           internal errors[] wired to failures[], source-level fault isolation
//
// ── Oracle class distinction ──────────────────────────────────────────────────
// This is NOT a pool-state fetcher. It does not use provider_factory, ethers,
// or block anchoring. It aggregates gas price data from HTTP APIs:
//   1. Infura Gas API   (primary  — EIP-1559 aware)
//   2. Etherscan        (backup   — legacy gwei tiers)
//   3. Direct RPC JSON  (fallback — raw eth_gasPrice)
//
// Because it uses HTTP sources rather than on-chain contract reads, the
// endpointIdsSeen / fetchConcurrency fields are not applicable and are
// emitted as null/[] for envelope schema consistency.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';
require('dotenv').config();

const fetch = require('node-fetch');

const CHAIN_ID  = 'ethereum';
const CHAIN_NUM = 1;

// ── ETH price stub ────────────────────────────────────────────────────────────
// WARNING: This is a hardcoded fallback used only for profitability threshold
// estimates inside this oracle. It is NOT sourced from live DEX data.
// Thresholds produced by calculateProfitabilityThresholds() will be stale
// if ETH price has moved significantly.
// TODO: Replace with live ETH/USDC price from uniswapV3Fetcher Redis key once
// cross-fetcher data sharing is wired into the pipeline.
const ETH_PRICE_USD_STUB = 2400;

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

// ── Source fetchers ───────────────────────────────────────────────────────────

async function fetchInfuraGas(apiKey) {
  const res = await fetch(
    `https://gas.api.infura.io/v3/${apiKey}/networks/1/suggestedGasFees`,
    { method: 'GET', headers: { 'Content-Type': 'application/json' } }
  );
  if (!res.ok) throw new Error(`Infura gas API HTTP ${res.status}`);
  const data = await res.json();
  return {
    low: {
      maxPriorityFeePerGas: parseFloat(data.low.suggestedMaxPriorityFeePerGas),
      maxFeePerGas:         parseFloat(data.low.suggestedMaxFeePerGas),
    },
    medium: {
      maxPriorityFeePerGas: parseFloat(data.medium.suggestedMaxPriorityFeePerGas),
      maxFeePerGas:         parseFloat(data.medium.suggestedMaxFeePerGas),
    },
    high: {
      maxPriorityFeePerGas: parseFloat(data.high.suggestedMaxPriorityFeePerGas),
      maxFeePerGas:         parseFloat(data.high.suggestedMaxFeePerGas),
    },
    estimatedBaseFee:      parseFloat(data.estimatedBaseFee),
    networkCongestion:     data.networkCongestion     || 0,
    priorityFeePercentile: data.priorityFeePercentile || null,
  };
}

async function fetchEtherscanGas(apiKey) {
  const res = await fetch(
    `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${apiKey}`
  );
  if (!res.ok) throw new Error(`Etherscan gas API HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== '1' || !data.result) {
    throw new Error(`Etherscan gas API bad response: status=${data.status}`);
  }
  return {
    safe:           parseFloat(data.result.SafeGasPrice),
    propose:        parseFloat(data.result.ProposeGasPrice),
    fast:           parseFloat(data.result.FastGasPrice),
    suggestBaseFee: parseFloat(data.result.suggestBaseFee),
    gasUsedRatio:   data.result.gasUsedRatio,
  };
}

async function fetchRpcGas(rpcUrl) {
  // Raw eth_gasPrice
  const gasPriceRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
  });
  if (!gasPriceRes.ok) throw new Error(`RPC eth_gasPrice HTTP ${gasPriceRes.status}`);
  const gasPriceData = await gasPriceRes.json();
  if (!gasPriceData.result) throw new Error('RPC eth_gasPrice returned no result');

  const gasPriceGwei = parseInt(gasPriceData.result, 16) / 1e9;
  let baseFeeGwei = null;

  // EIP-1559 base fee from latest block header
  try {
    const blockRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'eth_getBlockByNumber', params: ['latest', false], id: 2,
      }),
    });
    if (blockRes.ok) {
      const blockData = await blockRes.json();
      if (blockData.result?.baseFeePerGas) {
        baseFeeGwei = parseInt(blockData.result.baseFeePerGas, 16) / 1e9;
      }
    }
  } catch {
    // Base fee is bonus data — don't fail the whole RPC source if this errors
  }

  return { gasPrice: gasPriceGwei, baseFee: baseFeeGwei };
}

// ── Aggregation helpers ───────────────────────────────────────────────────────

function calculateConsensus(sources) {
  const { infura, etherscan, rpc } = sources;

  const consensus = {
    instant:  null,
    fast:     null,
    standard: null,
    slow:     null,
    baseFee:  null,
  };

  // Priority: Infura (EIP-1559 native) → Etherscan → RPC
  if (infura) {
    consensus.instant  = infura.high.maxFeePerGas;
    consensus.fast     = infura.medium.maxFeePerGas;
    consensus.standard = infura.low.maxFeePerGas;
    consensus.slow     = infura.low.maxFeePerGas * 0.9;
    consensus.baseFee  = infura.estimatedBaseFee;
  } else if (etherscan) {
    consensus.instant  = etherscan.fast;
    consensus.fast     = etherscan.propose;
    consensus.standard = etherscan.safe;
    consensus.slow     = etherscan.safe * 0.9;
    consensus.baseFee  = etherscan.suggestBaseFee;
  } else if (rpc) {
    const base         = rpc.gasPrice || rpc.baseFee || 0;
    consensus.instant  = base * 1.5;
    consensus.fast     = base * 1.2;
    consensus.standard = base;
    consensus.slow     = base * 0.9;
    consensus.baseFee  = rpc.baseFee ?? base;
  }

  // Round to 2 dp
  for (const k of Object.keys(consensus)) {
    if (consensus[k] !== null) consensus[k] = Math.round(consensus[k] * 100) / 100;
  }

  return consensus;
}

function calculateProfitabilityThresholds(consensus) {
  // Gas unit estimates per transaction type
  const GAS_ESTIMATES = {
    simpleSwap:         150_000,
    flashLoanSimple:    250_000,
    flashLoanTriangle:  400_000,
    flashLoanComplex:   600_000,
  };

  const thresholds = {};

  for (const [txType, gasUnits] of Object.entries(GAS_ESTIMATES)) {
    thresholds[txType] = {};
    for (const speed of ['slow', 'standard', 'fast', 'instant']) {
      const gweiPrice = consensus[speed];
      if (gweiPrice === null) {
        thresholds[txType][speed] = null;
        continue;
      }
      const gasCostETH = (gweiPrice * gasUnits) / 1e9;
      const gasCostUSD = gasCostETH * ETH_PRICE_USD_STUB;
      thresholds[txType][speed] = {
        gasCostETH:   Math.round(gasCostETH    * 1e6) / 1e6,
        gasCostUSD:   Math.round(gasCostUSD    * 100) / 100,
        minProfitUSD: Math.round(gasCostUSD * 1.5 * 100) / 100,  // 1.5x safety margin
      };
    }
  }

  return thresholds;
}

function analyzeNetworkState(sources, consensus) {
  const state = {
    congestion:      'unknown',
    recommendation:  'standard',
    flashLoanViable: true,
    baseFeeGwei:     consensus.baseFee,
    warnings:        [],
  };

  if (consensus.fast !== null) {
    if      (consensus.fast < 30)  { state.congestion = 'low';     state.recommendation = 'slow';     }
    else if (consensus.fast < 50)  { state.congestion = 'normal';  state.recommendation = 'standard'; }
    else if (consensus.fast < 100) {
      state.congestion = 'high';
      state.recommendation = 'fast';
      state.warnings.push('High gas prices — only large arbitrage opportunities are profitable');
    } else {
      state.congestion     = 'extreme';
      state.recommendation = 'wait';
      state.flashLoanViable = false;
      state.warnings.push('Extremely high gas — flash loans likely unprofitable');
    }
  }

  if (sources.infura?.networkCongestion > 0.7) {
    state.warnings.push(`Infura network congestion: ${(sources.infura.networkCongestion * 100).toFixed(0)}%`);
  }

  if (consensus.baseFee !== null && consensus.baseFee > 50) {
    state.warnings.push('High base fee — consider waiting for lower gas window');
  }

  return state;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function gasPriceOracle() {
  const startedAt  = Date.now();
  const startedIso = nowIso();

  const INFURA_API_KEY  = process.env.ETHEREUM_MAINNET_RPC_URL_1?.split('/v3/')[1];
  const ETHERSCAN_KEY   = process.env.ETHERSCAN_API_KEY;
  const ETHEREUM_RPC    = process.env.ETHEREUM_MAINNET_RPC_URL_1 || process.env.ETHEREUM_MAINNET_RPC_URL_2;

  const sources   = { infura: null, etherscan: null, rpc: null };
  const failures  = [];
  let sourcesHit  = 0;

  // ── Source 1: Infura Gas API ──────────────────────────────────────────────
  if (INFURA_API_KEY) {
    try {
      sources.infura = await fetchInfuraGas(INFURA_API_KEY);
      sourcesHit++;
    } catch (e) {
      failures.push({ source: 'infura', error: String(e.message || e).slice(0, 160) });
    }
  } else {
    failures.push({ source: 'infura', error: 'ETHEREUM_MAINNET_RPC_URL_1 not set or missing /v3/ key' });
  }

  // ── Source 2: Etherscan Gas Tracker ──────────────────────────────────────
  if (ETHERSCAN_KEY) {
    try {
      sources.etherscan = await fetchEtherscanGas(ETHERSCAN_KEY);
      sourcesHit++;
    } catch (e) {
      failures.push({ source: 'etherscan', error: String(e.message || e).slice(0, 160) });
    }
  } else {
    failures.push({ source: 'etherscan', error: 'ETHERSCAN_API_KEY not set' });
  }

  // ── Source 3: Direct RPC fallback ────────────────────────────────────────
  if (ETHEREUM_RPC) {
    try {
      sources.rpc = await fetchRpcGas(ETHEREUM_RPC);
      sourcesHit++;
    } catch (e) {
      failures.push({ source: 'rpc', error: String(e.message || e).slice(0, 160) });
    }
  } else {
    failures.push({ source: 'rpc', error: 'No Ethereum RPC URL configured' });
  }

  const consensus    = calculateConsensus(sources);
  const hasConsensus = Object.values(consensus).some((v) => v !== null);

  // ── Honest status ─────────────────────────────────────────────────────────
  // 'error'   → zero sources returned data AND no consensus
  // 'partial' → at least one source failed but we have usable consensus
  // 'success' → all configured sources succeeded
  const configuredSources = [
    INFURA_API_KEY  ? 'infura'    : null,
    ETHERSCAN_KEY   ? 'etherscan' : null,
    ETHEREUM_RPC    ? 'rpc'       : null,
  ].filter(Boolean).length;

  const status =
    !hasConsensus           ? 'error'   :
    sourcesHit < configuredSources ? 'partial' :
    'success';

  const thresholds   = hasConsensus ? calculateProfitabilityThresholds(consensus) : null;
  const networkState = hasConsensus ? analyzeNetworkState(sources, consensus)     : null;
  const durationMs   = Date.now() - startedAt;

  return {
    status,
    partial: status === 'partial',
    data: {
      chain:    CHAIN_ID,
      chain_id: CHAIN_NUM,
      sources,
      consensus,
      thresholds,
      networkState,
      timestamp:        startedIso,
      durationMs,
      // Oracle-class fields — HTTP sources, not on-chain RPC endpoints
      fetchConcurrency: null,   // N/A: sequential HTTP fetches by design
      endpointId:       null,   // N/A: no provider_factory routing
      endpoint:         null,
      endpointIdsSeen:  [],
      endpointsSeen:    [],
      stats: {
        sourcesConfigured: configuredSources,
        sourcesSucceeded:  sourcesHit,
        sourcesFailed:     failures.length,
      },
      failures,
      ethPriceStubUSD: ETH_PRICE_USD_STUB,  // surfaced so callers know thresholds are approximate
    },
  };
}

// ── CLI runner ────────────────────────────────────────────────────────────────

if (require.main === module) {
  gasPriceOracle()
    .then((result) => {
      console.log('\nGAS PRICE ORACLE — ETHEREUM MAINNET:');
      console.log('='.repeat(70));
      console.log(
        `status=${result.status} partial=${result.partial} ` +
        `sources=${result.data.stats.sourcesSucceeded}/${result.data.stats.sourcesConfigured} ` +
        `duration=${result.data.durationMs}ms`
      );

      const { consensus, networkState, thresholds } = result.data;

      if (consensus.fast !== null) {
        console.log('\nGas prices (gwei):');
        console.log(`  slow:     ${consensus.slow}`);
        console.log(`  standard: ${consensus.standard}`);
        console.log(`  fast:     ${consensus.fast}`);
        console.log(`  instant:  ${consensus.instant}`);
        console.log(`  baseFee:  ${consensus.baseFee}`);
      }

      if (networkState) {
        console.log(`\nNetwork: ${networkState.congestion.toUpperCase()} | recommend=${networkState.recommendation} | flashLoan=${networkState.flashLoanViable ? 'viable' : 'NOT viable'}`);
        if (networkState.warnings.length) {
          networkState.warnings.forEach((w) => console.log(`  ⚠  ${w}`));
        }
      }

      if (thresholds?.flashLoanTriangle?.fast) {
        const t = thresholds.flashLoanTriangle.fast;
        console.log(`\nFlash loan triangle arb (fast): gas=$${t.gasCostUSD} | minProfit=$${t.minProfitUSD}`);
        console.log(`  (ETH price stub: $${result.data.ethPriceStubUSD} — replace with live oracle)`);
      }

      if (result.data.failures.length) {
        console.log('\nFailures:');
        result.data.failures.forEach((f) => console.log(`  ${f.source}: ${f.error}`));
      }

      console.log('='.repeat(70));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

// ── Exports ───────────────────────────────────────────────────────────────────

gasPriceOracle.chain = CHAIN_ID;
module.exports = gasPriceOracle;
