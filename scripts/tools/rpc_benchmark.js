// scripts/tools/rpc_benchmark.js
// RPC transport benchmark tool — AllMight
//
// PURPOSE
//   Measure actual RPC endpoint quality under AllMight-style workload.
//   This is the final gate before paid RPC upgrades.
//   Do NOT upgrade providers until you have run this and read the scorecards.
//
// USAGE
//   node scripts/tools/rpc_benchmark.js --chain arbitrum
//   node scripts/tools/rpc_benchmark.js --chain ethereum --samples 30
//   node scripts/tools/rpc_benchmark.js --all
//   node scripts/tools/rpc_benchmark.js --all --burst-concurrency 4 --out logs/bench
//
// FLAGS
//   --chain <name>           single chain: ethereum | arbitrum | optimism | base | unichain
//   --all                    benchmark all configured chains
//   --samples <n>            serial samples per test (default 20)
//   --timeout-ms <n>         per-call timeout in ms (default 1500)
//   --burst-rounds <n>       burst test rounds (default 5)
//   --burst-concurrency <n>  concurrent requests per burst round (default 4)
//   --out <dir>              output directory (default logs/rpc_benchmark)
//
// ENDPOINTS
//   Loaded from provider_factory env vars — no new config required.
//   All endpoints already configured in your .env are benchmarked automatically.
//
// OUTPUT
//   logs/rpc_benchmark/<chain>_scorecard.json  — per-endpoint metrics
//   logs/rpc_benchmark/summary.json            — aggregate rankings
//   stdout                                     — human-readable summary table
//
// DESIGN
//   Standalone tool. Does NOT use provider_factory routing or health tracking.
//   Each endpoint gets a fresh, unbiased provider so benchmark results reflect
//   true transport quality, not accumulated health scores from live fetcher runs.

'use strict';
require('dotenv').config();

const { ethers } = require('ethers');
const fs         = require('fs');
const path       = require('path');

// Reuse provider_factory's env-var→URL mapping — no need to reinvent it.
const { getChainRpcUrls } = require('../../utils/provider_factory');

// ── Chain config table ────────────────────────────────────────────────────────
//
// sampleCall: cheap, deterministic, read-only eth_call for transport timing.
// Using ERC20 decimals() (selector 0x313ce567) on a canonical stable token.
// This is for transport timing ONLY — not price or business logic.

const CHAIN_CONFIGS = {
  ethereum: {
    chainId:   1,
    networkName: 'mainnet',
    label:     'ethereum',
    sampleCall: {
      to:   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
      data: '0x313ce567',                                  // decimals()
      desc: 'USDC.decimals()',
    },
  },
  arbitrum: {
    chainId:   42161,
    networkName: 'arbitrum',
    label:     'arbitrum',
    sampleCall: {
      to:   '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // USDC.e on Arbitrum
      data: '0x313ce567',
      desc: 'USDC.e.decimals()',
    },
  },
  optimism: {
    chainId:   10,
    networkName: 'optimism',
    label:     'optimism',
    sampleCall: {
      to:   '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', // USDC on Optimism
      data: '0x313ce567',
      desc: 'USDC.decimals()',
    },
  },
  base: {
    chainId:   8453,
    networkName: 'base',
    label:     'base',
    sampleCall: {
      to:   '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
      data: '0x313ce567',
      desc: 'USDC.decimals()',
    },
  },
  unichain: {
    chainId:   130,
    networkName: 'unichain',
    label:     'unichain',
    sampleCall: {
      to:   '0x4200000000000000000000000000000000000006', // WETH on Unichain
      data: '0x313ce567',
      desc: 'WETH.decimals()',
    },
  },
};

// ── CLI parsing ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    chains:           [],
    all:              false,
    samples:          20,
    timeoutMs:        1500,
    burstRounds:      5,
    burstConcurrency: 4,
    outDir:           path.resolve(process.cwd(), 'logs', 'rpc_benchmark'),
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--all')                   { opts.all = true; }
    else if (a === '--chain')            { opts.chains.push(args[++i]); }
    else if (a === '--samples')          { opts.samples = Math.max(1, Number(args[++i]) || 20); }
    else if (a === '--timeout-ms')       { opts.timeoutMs = Math.max(500, Number(args[++i]) || 1500); }
    else if (a === '--burst-rounds')     { opts.burstRounds = Math.max(1, Number(args[++i]) || 5); }
    else if (a === '--burst-concurrency'){ opts.burstConcurrency = Math.max(1, Number(args[++i]) || 4); }
    else if (a === '--out')              { opts.outDir = path.resolve(args[++i]); }
  }

  if (opts.all) {
    opts.chains = Object.keys(CHAIN_CONFIGS);
  }

  if (!opts.chains.length) {
    console.error('ERROR: specify --chain <name> or --all');
    console.error('Chains: ' + Object.keys(CHAIN_CONFIGS).join(' | '));
    process.exit(1);
  }

  // Validate chain names
  for (const c of opts.chains) {
    if (!CHAIN_CONFIGS[c]) {
      console.error(`ERROR: unknown chain "${c}". Valid: ${Object.keys(CHAIN_CONFIGS).join(', ')}`);
      process.exit(1);
    }
  }

  return opts;
}

// ── Provider factory (benchmark-local) ───────────────────────────────────────
// Fresh provider per URL, bypassing provider_factory health tracking.
// This ensures benchmark results reflect raw endpoint performance only.

const _benchProviders = new Map();

function makeProvider(url, chainCfg) {
  const key = `${chainCfg.label}::${url}`;
  if (!_benchProviders.has(key)) {
    const network = ethers.Network.from({ name: chainCfg.networkName, chainId: chainCfg.chainId });
    _benchProviders.set(key, new ethers.JsonRpcProvider(url, network, {
      staticNetwork: network,
      batchMaxCount: 1,
    }));
  }
  return _benchProviders.get(key);
}

function redactUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const path20 = u.pathname.slice(0, 8);
    return `${host}${path20}…`;
  } catch {
    return String(url).slice(0, 30) + '…';
  }
}

// ── Timing primitive ──────────────────────────────────────────────────────────

async function timeCall(fn, timeoutMs) {
  const started = Date.now();
  try {
    const resultPromise = fn();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error(`timeout after ${timeoutMs}ms`), { isTimeout: true })), timeoutMs)
    );
    const result = await Promise.race([resultPromise, timeoutPromise]);
    return { ok: true, durationMs: Date.now() - started, result };
  } catch (e) {
    return { ok: false, durationMs: Date.now() - started, isTimeout: Boolean(e.isTimeout), error: String(e.message || e).slice(0, 120) };
  }
}

// ── Percentile math ───────────────────────────────────────────────────────────

function computePercentiles(values) {
  if (!values.length) return { p50: null, p95: null, p99: null, mean: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p / 100))];
  const mean = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
  return {
    p50:  pct(50),
    p95:  pct(95),
    p99:  pct(99),
    mean,
    min:  sorted[0],
    max:  sorted[sorted.length - 1],
  };
}

// ── Mode A: block number latency ──────────────────────────────────────────────

async function runBlockSamples(provider, n, timeoutMs) {
  const latencies  = [];
  const blocks     = [];
  let failures = 0;
  let timeouts = 0;

  for (let i = 0; i < n; i++) {
    const r = await timeCall(() => provider.getBlockNumber(), timeoutMs);
    if (r.ok) {
      latencies.push(r.durationMs);
      blocks.push(r.result);
    } else {
      failures++;
      if (r.isTimeout) timeouts++;
    }
  }

  const percs = computePercentiles(latencies);
  return {
    ...percs,
    successes:    latencies.length,
    failures,
    timeouts,
    latestBlock:  blocks.length ? Math.max(...blocks) : null,
  };
}

// ── Mode B: eth_call latency ──────────────────────────────────────────────────

async function runEthCallSamples(provider, chainCfg, n, timeoutMs) {
  const latencies = [];
  let failures = 0;
  let timeouts = 0;

  const callObj = {
    to:   chainCfg.sampleCall.to,
    data: chainCfg.sampleCall.data,
  };

  for (let i = 0; i < n; i++) {
    const r = await timeCall(() => provider.call(callObj), timeoutMs);
    if (r.ok) {
      latencies.push(r.durationMs);
    } else {
      failures++;
      if (r.isTimeout) timeouts++;
    }
  }

  const percs = computePercentiles(latencies);
  return {
    ...percs,
    successes: latencies.length,
    failures,
    timeouts,
  };
}

// ── Mode C: burst test ────────────────────────────────────────────────────────

async function runBurstSamples(provider, chainCfg, rounds, concurrency, timeoutMs) {
  const allLatencies = [];
  let totalFailures = 0;
  let totalTimeouts = 0;
  const totalRequests = rounds * concurrency;

  const callObj = {
    to:   chainCfg.sampleCall.to,
    data: chainCfg.sampleCall.data,
  };

  for (let round = 0; round < rounds; round++) {
    const batch = Array.from({ length: concurrency }, () =>
      timeCall(() => provider.call(callObj), timeoutMs)
    );
    const results = await Promise.all(batch);
    for (const r of results) {
      if (r.ok) {
        allLatencies.push(r.durationMs);
      } else {
        totalFailures++;
        if (r.isTimeout) totalTimeouts++;
      }
    }
  }

  const percs = computePercentiles(allLatencies);
  return {
    rounds,
    concurrency,
    requests:  totalRequests,
    successes: allLatencies.length,
    failures:  totalFailures,
    timeouts:  totalTimeouts,
    ...percs,
  };
}

// ── Mode D: block lag ─────────────────────────────────────────────────────────
// Computed after all endpoints are benchmarked for a chain.

function computeBlockLag(endpointResults) {
  const blocks = endpointResults
    .map(r => r.blockNumber?.latestBlock)
    .filter(b => b !== null && b !== undefined);

  if (!blocks.length) return null;
  return Math.max(...blocks);
}

// ── Scoring ───────────────────────────────────────────────────────────────────
//
// Lower score = better endpoint.
//
// Scoring formula (spec §12):
//   (p50_block  × 0.20)
// + (p95_block  × 0.20)
// + (p50_call   × 0.20)
// + (p95_call   × 0.20)
// + timeout_penalty
// + failure_penalty
// + lag_penalty
// + burst_degradation_penalty

function scoreEndpoint(metrics) {
  const bn   = metrics.blockNumber;
  const ec   = metrics.ethCall;
  const bu   = metrics.burst;
  const lag  = metrics.lag?.lagBlocks ?? 0;

  const bnSamples  = (bn.successes + bn.failures) || 1;
  const ecSamples  = (ec.successes + ec.failures) || 1;
  const buRequests = bu.requests || 1;

  const timeoutRate   = (bn.timeouts + ec.timeouts + bu.timeouts) / (bnSamples + ecSamples + buRequests);
  const failureRate   = (bn.failures  + ec.failures  + bu.failures)  / (bnSamples + ecSamples + buRequests);
  const burstFailRate = bu.failures / buRequests;

  // Latency base (nulls → heavy penalty so broken endpoints score badly)
  const p50b = bn.p50 ?? 5000;
  const p95b = bn.p95 ?? 5000;
  const p50c = ec.p50 ?? 5000;
  const p95c = ec.p95 ?? 5000;

  const latencyScore = (p50b * 0.20) + (p95b * 0.20) + (p50c * 0.20) + (p95c * 0.20);

  const timeoutPenalty    = timeoutRate   * 3000;  // heavy
  const failurePenalty    = failureRate   * 3000;  // heavy
  const lagPenalty        = lag           * 500;   // very heavy per block
  const burstPenalty      = burstFailRate * 1500;  // moderate

  const score = latencyScore + timeoutPenalty + failurePenalty + lagPenalty + burstPenalty;
  return Math.round(score * 10) / 10;
}

// ── Role classification ───────────────────────────────────────────────────────

function classifyEndpoint(score, metrics) {
  const bn = metrics.blockNumber;
  const bu = metrics.burst;

  const timeoutRate = (bn.timeouts + bu.timeouts) / Math.max(1, bn.successes + bn.failures + bu.requests);
  const lagBlocks   = metrics.lag?.lagBlocks ?? 0;

  if (timeoutRate > 0.20 || lagBlocks >= 5 || (bn.failures + bu.failures) / Math.max(1, bn.successes + bn.failures + bu.requests) > 0.25) {
    return 'reject';
  }
  if (score < 400)  return 'primary';
  if (score < 800)  return 'backup';
  if (score < 1500) return 'fallback';
  return 'reject';
}

// ── Per-endpoint benchmark orchestrator ───────────────────────────────────────

async function benchmarkEndpoint(url, chainCfg, params, endpointIndex) {
  const { samples, timeoutMs, burstRounds, burstConcurrency } = params;
  const label    = `ep${endpointIndex}`;
  const redacted = redactUrl(url);

  console.log(`  [${chainCfg.label}] ${label} ${redacted} — block×${samples}, call×${samples}, burst ${burstRounds}r×${burstConcurrency}c`);

  let provider;
  try {
    provider = makeProvider(url, chainCfg);
  } catch (e) {
    console.error(`  [${chainCfg.label}] ${label} provider init failed: ${e.message}`);
    return null;
  }

  // Run all three active modes — failures are isolated per mode
  const [blockNumber, ethCall, burst] = await Promise.all([
    runBlockSamples(provider, samples, timeoutMs).catch(e => ({
      p50: null, p95: null, p99: null, mean: null, min: null, max: null,
      successes: 0, failures: samples, timeouts: 0, latestBlock: null,
      _error: e.message,
    })),
    runEthCallSamples(provider, chainCfg, samples, timeoutMs).catch(e => ({
      p50: null, p95: null, p99: null, mean: null, min: null, max: null,
      successes: 0, failures: samples, timeouts: 0,
      _error: e.message,
    })),
    runBurstSamples(provider, chainCfg, burstRounds, burstConcurrency, timeoutMs).catch(e => ({
      rounds: burstRounds, concurrency: burstConcurrency,
      requests: burstRounds * burstConcurrency,
      successes: 0, failures: burstRounds * burstConcurrency, timeouts: 0,
      p50: null, p95: null, p99: null, mean: null, min: null, max: null,
      _error: e.message,
    })),
  ]);

  return {
    endpointIndex,
    endpointLabel: label,
    url,                    // kept internally for lag comparison
    urlRedacted:   redacted,
    samples: { blockNumber: samples, ethCall: samples },
    blockNumber,
    ethCall,
    burst,
    lag: null,              // filled in by computeBlockLag after all endpoints run
    score: null,            // filled in after lag is computed
    recommendedRole: null,  // filled in after scoring
  };
}

// ── Per-chain benchmark ───────────────────────────────────────────────────────

async function benchmarkChain(chainName, params) {
  const chainCfg = CHAIN_CONFIGS[chainName];
  if (!chainCfg) {
    console.error(`[rpc_benchmark] Unknown chain: ${chainName}`);
    return null;
  }

  const urls = getChainRpcUrls(chainName);
  if (!urls.length) {
    console.warn(`[rpc_benchmark] No endpoints configured for chain: ${chainName} — skipping`);
    return { chain: chainName, endpoints: [], skipped: true };
  }

  console.log(`\n[${chainName}] Benchmarking ${urls.length} endpoint(s) — sample call: ${chainCfg.sampleCall.desc}`);

  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const result = await benchmarkEndpoint(urls[i], chainCfg, params, i);
    if (result) results.push(result);
  }

  if (!results.length) {
    return { chain: chainName, endpoints: [], skipped: false };
  }

  // ── Mode D: block lag ─────────────────────────────────────────────────────
  const bestBlock = computeBlockLag(results);

  for (const r of results) {
    const endpointBlock = r.blockNumber?.latestBlock ?? null;
    r.lag = {
      bestObservedBlock: bestBlock,
      endpointBlock,
      lagBlocks: (bestBlock !== null && endpointBlock !== null) ? bestBlock - endpointBlock : null,
    };
  }

  // ── Scoring ───────────────────────────────────────────────────────────────
  for (const r of results) {
    r.score           = scoreEndpoint(r);
    r.recommendedRole = classifyEndpoint(r.score, r);
  }

  // Sort ascending by score (lower = better)
  results.sort((a, b) => a.score - b.score);

  return { chain: chainName, endpoints: results, skipped: false };
}

// ── Output ────────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeScorecard(outDir, chainResult) {
  ensureDir(outDir);
  const file = path.join(outDir, `${chainResult.chain}_scorecard.json`);

  // Strip internal url field before writing — keep urlRedacted only
  const safe = {
    ...chainResult,
    endpoints: chainResult.endpoints.map(({ url: _url, ...rest }) => rest),
  };

  fs.writeFileSync(file, JSON.stringify(safe, null, 2));
  return file;
}

function writeSummary(outDir, allResults) {
  ensureDir(outDir);
  const file = path.join(outDir, 'summary.json');

  const summary = {
    generatedAt: new Date().toISOString(),
    chains: allResults.map((cr) => ({
      chain:     cr.chain,
      skipped:   cr.skipped,
      endpoints: cr.endpoints.map((ep) => ({
        endpointLabel:   ep.endpointLabel,
        urlRedacted:     ep.urlRedacted,
        score:           ep.score,
        recommendedRole: ep.recommendedRole,
        p50_block_ms:    ep.blockNumber?.p50  ?? null,
        p95_block_ms:    ep.blockNumber?.p95  ?? null,
        p50_call_ms:     ep.ethCall?.p50      ?? null,
        p95_call_ms:     ep.ethCall?.p95      ?? null,
        failures_total:  (ep.blockNumber?.failures ?? 0) + (ep.ethCall?.failures ?? 0) + (ep.burst?.failures ?? 0),
        timeouts_total:  (ep.blockNumber?.timeouts ?? 0) + (ep.ethCall?.timeouts ?? 0) + (ep.burst?.timeouts ?? 0),
        lagBlocks:       ep.lag?.lagBlocks    ?? null,
      })),
    })),
  };

  fs.writeFileSync(file, JSON.stringify(summary, null, 2));
  return file;
}

function printConsoleTable(allResults) {
  console.log('\n' + '='.repeat(100));
  console.log('RPC BENCHMARK RESULTS');
  console.log('='.repeat(100));

  for (const cr of allResults) {
    if (cr.skipped) {
      console.log(`\n[${cr.chain}] No endpoints configured — skipped`);
      continue;
    }
    console.log(`\n[${cr.chain}] ${cr.endpoints.length} endpoint(s)`);
    console.log(
      '  ' +
      'ep'.padEnd(4) +
      'role'.padEnd(10) +
      'score'.padEnd(8) +
      'p50b'.padEnd(8) +
      'p95b'.padEnd(8) +
      'p50c'.padEnd(8) +
      'p95c'.padEnd(8) +
      'fail'.padEnd(6) +
      'tout'.padEnd(6) +
      'lag'.padEnd(5) +
      'endpoint'
    );
    console.log('  ' + '-'.repeat(94));

    for (const ep of cr.endpoints) {
      const role   = ep.recommendedRole ?? '?';
      const p50b   = ep.blockNumber?.p50  != null ? ep.blockNumber.p50  + 'ms' : 'n/a';
      const p95b   = ep.blockNumber?.p95  != null ? ep.blockNumber.p95  + 'ms' : 'n/a';
      const p50c   = ep.ethCall?.p50      != null ? ep.ethCall.p50      + 'ms' : 'n/a';
      const p95c   = ep.ethCall?.p95      != null ? ep.ethCall.p95      + 'ms' : 'n/a';
      const fails  = (ep.blockNumber?.failures ?? 0) + (ep.ethCall?.failures ?? 0) + (ep.burst?.failures ?? 0);
      const touts  = (ep.blockNumber?.timeouts ?? 0) + (ep.ethCall?.timeouts ?? 0) + (ep.burst?.timeouts ?? 0);
      const lag    = ep.lag?.lagBlocks != null ? ep.lag.lagBlocks : '?';

      console.log(
        '  ' +
        ep.endpointLabel.padEnd(4) +
        role.padEnd(10) +
        String(ep.score).padEnd(8) +
        p50b.padEnd(8) +
        p95b.padEnd(8) +
        p50c.padEnd(8) +
        p95c.padEnd(8) +
        String(fails).padEnd(6) +
        String(touts).padEnd(6) +
        String(lag).padEnd(5) +
        ep.urlRedacted
      );
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('Scoring: lower = better | primary < 400 | backup < 800 | fallback < 1500 | reject ≥ 1500');
  console.log('='.repeat(100));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const params = parseArgs();

  console.log('[rpc_benchmark] Starting benchmark');
  console.log(`  chains:           ${params.chains.join(', ')}`);
  console.log(`  samples:          ${params.samples}`);
  console.log(`  timeoutMs:        ${params.timeoutMs}`);
  console.log(`  burstRounds:      ${params.burstRounds}`);
  console.log(`  burstConcurrency: ${params.burstConcurrency}`);
  console.log(`  outDir:           ${params.outDir}`);

  const allResults = [];

  for (const chainName of params.chains) {
    try {
      const result = await benchmarkChain(chainName, params);
      if (result) allResults.push(result);
    } catch (e) {
      // Never crash the whole run on one chain failure
      console.error(`[rpc_benchmark] chain ${chainName} failed unexpectedly: ${e.message}`);
      allResults.push({ chain: chainName, endpoints: [], skipped: true, error: e.message });
    }
  }

  // ── Write output ──────────────────────────────────────────────────────────
  const writtenFiles = [];

  for (const cr of allResults) {
    try {
      const f = writeScorecard(params.outDir, cr);
      writtenFiles.push(f);
      console.log(`\n[rpc_benchmark] Scorecard written: ${f}`);
    } catch (e) {
      console.error(`[rpc_benchmark] Failed to write scorecard for ${cr.chain}: ${e.message}`);
    }
  }

  try {
    const f = writeSummary(params.outDir, allResults);
    writtenFiles.push(f);
    console.log(`[rpc_benchmark] Summary written:   ${f}`);
  } catch (e) {
    console.error(`[rpc_benchmark] Failed to write summary: ${e.message}`);
  }

  printConsoleTable(allResults);

  console.log(`\n[rpc_benchmark] Done. ${writtenFiles.length} file(s) written to ${params.outDir}`);
}

main().catch((err) => {
  console.error('[rpc_benchmark] Fatal:', err.message);
  process.exit(1);
});
