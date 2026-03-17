'use strict';

/*
Provider Factory
----------------
Purpose:
Robust RPC provider manager for AllMight fetchers.

Features:
- endpoint health tracking (latency strikes + failure demotion)
- global runtime freshness-aware health (block-lag penalty scoring)
- round-robin rotation within freshness tier (fresh endpoints always attempt first)
- hedged RPC requests
- degraded retry if all endpoints demoted
- explicit static network config per chain
- graceful fallback if freshness probing fails
*/

const { ethers } = require('ethers');
const fs         = require('fs');
const path       = require('path');

// ── Freshness telemetry writer ────────────────────────────────────────────────
// Append-only JSONL — one event per line, fire-and-forget, never blocks routing.
// Location: logs/rpc_freshness.jsonl (relative to process.cwd())
// Disabled via RPC_FRESHNESS_LOG_ENABLED=0

const FRESHNESS_LOG_ENABLED = process.env.RPC_FRESHNESS_LOG_ENABLED !== '0';
const FRESHNESS_LOG_PATH    = path.resolve(
  process.cwd(),
  process.env.RPC_FRESHNESS_LOG_PATH || 'logs/rpc_freshness.jsonl'
);

function _ensureLogDir() {
  try {
    const dir = path.dirname(FRESHNESS_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* silent — never block */ }
}
_ensureLogDir();

function _logEvent(obj) {
  if (!FRESHNESS_LOG_ENABLED) return;
  try {
    fs.appendFile(FRESHNESS_LOG_PATH, JSON.stringify(obj) + '\n', () => {});
  } catch { /* fire-and-forget — silent on error */ }
}

const RPC_CALL_TIMEOUT_MS = Number(process.env.RPC_CALL_TIMEOUT_MS || 1500);
const RPC_SLOW_THRESHOLD_MS = Number(process.env.RPC_SLOW_THRESHOLD_MS || 1000);
const RPC_SLOW_STRIKES = Number(process.env.RPC_SLOW_STRIKES || 2);
const MAX_FAILS = Number(process.env.RPC_MAX_FAILS || 3);
const RPC_HEDGE_DELAY_MS = Number(process.env.RPC_HEDGE_DELAY_MS || 250);

// ── Global RPC Freshness-Aware Health (EVM v1) ────────────────────────────────
// Extends existing latency+failure health with runtime block-lag awareness.
// Probes eth_blockNumber across all endpoints per chain, computes lag, and
// applies short-lived score penalties so stale endpoints sort to the back of
// the candidate list during selection. Gracefully falls back to existing
// behavior if probing fails. No static ordering assumptions.
//
// Benchmark tool (rpc_benchmark.js) = offline measurement.
// This layer                         = runtime continuous adaptation.
//
// Env vars (all optional — safe defaults shown):
//   RPC_FRESHNESS_AWARE_ENABLED=1       set to 0 to disable entirely
//   RPC_FRESHNESS_REFRESH_MS=20000      how often to re-probe per chain
//   RPC_FRESHNESS_PROBE_TIMEOUT_MS=800  per-endpoint probe timeout
//   RPC_FRESHNESS_WARNING_BLOCKS=2      lag threshold for small penalty
//   RPC_FRESHNESS_STALE_BLOCKS=4        lag threshold for medium penalty
//   RPC_FRESHNESS_SEVERE_BLOCKS=8       lag threshold for heavy penalty
//   RPC_FRESHNESS_PENALTY_MS=30000      how long a penalty lasts
//   RPC_FRESHNESS_WARNING_PENALTY=300   score added for warning lag
//   RPC_FRESHNESS_STALE_PENALTY=1000    score added for stale lag
//   RPC_FRESHNESS_SEVERE_PENALTY=3000   score added for severe lag

const FRESHNESS_ENABLED         = process.env.RPC_FRESHNESS_AWARE_ENABLED !== '0';
const FRESHNESS_REFRESH_MS      = Number(process.env.RPC_FRESHNESS_REFRESH_MS       || 20000);
const FRESHNESS_PROBE_TIMEOUT   = Number(process.env.RPC_FRESHNESS_PROBE_TIMEOUT_MS || 800);
const FRESHNESS_WARNING_BLOCKS  = Number(process.env.RPC_FRESHNESS_WARNING_BLOCKS   || 2);
const FRESHNESS_STALE_BLOCKS    = Number(process.env.RPC_FRESHNESS_STALE_BLOCKS     || 4);
const FRESHNESS_SEVERE_BLOCKS   = Number(process.env.RPC_FRESHNESS_SEVERE_BLOCKS    || 8);
const FRESHNESS_PENALTY_MS      = Number(process.env.RPC_FRESHNESS_PENALTY_MS       || 30000);
const FRESHNESS_WARNING_PENALTY = Number(process.env.RPC_FRESHNESS_WARNING_PENALTY  || 300);
const FRESHNESS_STALE_PENALTY   = Number(process.env.RPC_FRESHNESS_STALE_PENALTY    || 1000);
const FRESHNESS_SEVERE_PENALTY  = Number(process.env.RPC_FRESHNESS_SEVERE_PENALTY   || 3000);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function redactUrl(url) {
  return String(url || '').replace(/^https?:\/\//, '');
}

function withTimeout(promise, ms, label) {
  let timer;

  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`RPC timeout after ${ms}ms (${label})`);
        err.code = 'RPC_TIMEOUT';
        reject(err);
      }, ms);
    })
  ]);
}

class EndpointHealth {
  constructor() {
    this.map = new Map();
  }

  _entry(url) {
    if (!this.map.has(url)) {
      this.map.set(url, {
        fails: 0,
        slowStrikes: 0,
        demoted: false
      });
    }
    return this.map.get(url);
  }

  recordSuccess(url, duration) {
    const e = this._entry(url);

    e.fails = 0;

    if (duration > RPC_SLOW_THRESHOLD_MS) {
      e.slowStrikes++;
    } else {
      e.slowStrikes = Math.max(0, e.slowStrikes - 1);
      e.demoted = false;
    }

    if (e.slowStrikes >= RPC_SLOW_STRIKES) {
      e.demoted = true;
    }
  }

  recordFailure(url) {
    const e = this._entry(url);

    e.fails++;

    if (e.fails >= MAX_FAILS) {
      e.demoted = true;
    }
  }

  isAvailable(url) {
    const e = this._entry(url);
    return !e.demoted;
  }
}

const _health = new EndpointHealth();
const _providerCache = new Map();
const _rrStart = {};

// ── Freshness state ───────────────────────────────────────────────────────────
// Per-URL: { lastBlock, lagBlocks, penaltyScore, penaltyUntil, lastCheckedAt }
// Per-chain: refresh timestamp + in-flight lock to prevent probe stampede.

const _freshness        = new Map();   // url → freshness entry
const _freshnessRefresh = {};          // chainKey → last refresh timestamp ms
const _freshnessLock    = {};          // chainKey → boolean (prevents concurrent probes)

function _freshnessEntry(url) {
  if (!_freshness.has(url)) {
    _freshness.set(url, {
      lastBlock:    null,
      lagBlocks:    null,
      penaltyScore: 0,
      penaltyUntil: 0,
      lastCheckedAt: 0,
    });
  }
  return _freshness.get(url);
}

// Returns virtual ms penalty for this URL (0 = fresh, higher = more stale).
// Used to sort candidates so fresher endpoints are tried first.
function getFreshnessPenalty(url) {
  if (!FRESHNESS_ENABLED) return 0;
  const e = _freshness.get(url);
  if (!e || e.penaltyUntil <= Date.now()) return 0;
  return e.penaltyScore;
}

// Background freshness probe for all endpoints on a chain.
// Fire-and-forget — never blocks the caller.
async function _probeFreshnessForChain(chainKey, urls) {
  if (_freshnessLock[chainKey]) return;   // already in flight
  _freshnessLock[chainKey]    = true;
  _freshnessRefresh[chainKey] = Date.now();

  try {
    // Probe all endpoints concurrently with a short timeout.
    const probes = await Promise.allSettled(urls.map(async (url) => {
      const provider = getOrCreateProvider(chainKey, url);
      const block    = await withTimeout(
        provider.getBlockNumber(),
        FRESHNESS_PROBE_TIMEOUT,
        `freshness:${chainKey}:${redactUrl(url).slice(0, 20)}`
      );
      return { url, block };
    }));

    const succeeded = probes
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    // Emit per-endpoint probe failure for every rejected result.
    // Promise.allSettled() never throws on individual failures — they must be
    // pulled from the rejected entries here. This is what makes "Ankr disappeared
    // from the snapshot" distinguishable from "Ankr was just stale."
    const _probeNow = new Date().toISOString();
    probes.forEach((r, i) => {
      if (r.status === 'rejected') {
        _logEvent({
          ev:        'freshness_probe_fail',
          ts:        _probeNow,
          chain:     chainKey,
          url:       redactUrl(urls[i]),
          errorCode: r.reason?.code  || null,
          error:     String(r.reason?.message || r.reason).slice(0, 120),
        });
      }
    });

    if (!succeeded.length) return;   // all probes failed — preserve old state

    const bestBlock = Math.max(...succeeded.map(r => r.block));
    const now       = Date.now();

    for (const { url, block } of succeeded) {
      const lag  = bestBlock - block;
      const e    = _freshnessEntry(url);
      const prevPenalty = e.penaltyScore;   // capture before update for change detection
      e.lastBlock    = block;
      e.lagBlocks    = lag;
      e.lastCheckedAt = now;

      if (lag >= FRESHNESS_SEVERE_BLOCKS) {
        e.penaltyScore = FRESHNESS_SEVERE_PENALTY;
        e.penaltyUntil = now + FRESHNESS_PENALTY_MS;
      } else if (lag >= FRESHNESS_STALE_BLOCKS) {
        e.penaltyScore = FRESHNESS_STALE_PENALTY;
        e.penaltyUntil = now + FRESHNESS_PENALTY_MS;
      } else if (lag >= FRESHNESS_WARNING_BLOCKS) {
        e.penaltyScore = FRESHNESS_WARNING_PENALTY;
        e.penaltyUntil = now + FRESHNESS_PENALTY_MS;
      } else {
        // Fresh — clear any existing penalty
        e.penaltyScore = 0;
        e.penaltyUntil = 0;
      }

      // Emit penalty_change when tier shifts (not on every probe — only on transition).
      if (e.penaltyScore !== prevPenalty) {
        _logEvent({
          ev:         'penalty_change',
          ts:         new Date().toISOString(),
          chain:      chainKey,
          url:        redactUrl(url),
          lag,
          prevPenalty,
          newPenalty: e.penaltyScore,
        });
      }
    }
    // Endpoints that failed the probe keep their existing state (no change).

    // Emit freshness snapshot — one record per probe cycle per chain.
    _logEvent({
      ev:        'freshness_snapshot',
      ts:        new Date().toISOString(),
      chain:     chainKey,
      bestBlock,
      endpoints: succeeded.map(({ url, block }) => ({
        url:     redactUrl(url),
        lag:     bestBlock - block,
        penalty: getFreshnessPenalty(url),
      })),
    });

  } catch (probeErr) {
    // Probe error — silently preserve existing state. Never break routing.
    _logEvent({
      ev:    'freshness_probe_fail',
      ts:    new Date().toISOString(),
      chain: chainKey,
      error: String(probeErr?.message || probeErr).slice(0, 120),
    });
  } finally {
    _freshnessLock[chainKey] = false;
  }
}

// Trigger a background probe if the cache is stale. Non-blocking.
// Only probes chains with ≥ 2 endpoints (no point comparing against self).
function _maybeRefreshFreshness(chainKey, urls) {
  if (!FRESHNESS_ENABLED || urls.length < 2) return;
  const age = Date.now() - (_freshnessRefresh[chainKey] || 0);
  if (age > FRESHNESS_REFRESH_MS) {
    _probeFreshnessForChain(chainKey, urls).catch(() => {});
  }
}

function cleanRpcList(values) {
  return values
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
}

function getChainRpcUrls(chain) {
  const chainKey = String(chain).toLowerCase();

  // Endpoint ordering is benchmark-derived (APPX_RPC_MESH_POLICY_V1, March 2026).
  // Order = priority: first healthy endpoint wins round-robin rotation.
  // Hardcoded public fallbacks that benchmarked as unreliable have been removed.
  // LlamaRPC rejected across all chains. Public chain RPCs rejected from critical routing.
  //
  // NOTE: Authenticated keys (Infura/Alchemy/Ankr) must be wired into _MAINNET_RPC_URL_N
  // vars in .env for the factory to see them. *_RPC_URLS comma-lists are NOT read here —
  // only the benchmark tool reads both patterns. This is a known env cleanup deferred item.
  //
  // Arbitrum: Infura primary only. No healthy backup in tested set.
  // Procurement target: Chainstack or dRPC before scaling Arbitrum load.
  const RPCS = {
    // Ethereum: Alchemy → Infura → Ankr (benchmark order)
    ethereum: cleanRpcList([
      process.env.ETH_RPC_URL,                    // slot 0: Alchemy (benchmark primary)
      process.env.ETHEREUM_MAINNET_RPC_URL_1,      // slot 1: Infura  (benchmark backup)
      process.env.ETHEREUM_MAINNET_RPC_URL_2,      // slot 2: Ankr    (benchmark tertiary)
      process.env.ETHEREUM_MAINNET_RPC_URL,        // slot 3: legacy alias
    ]),
    // TEMPORARY ARBITRUM EMERGENCY OVERRIDE (March 2026)
    // Fresh 20-sample benchmark showed arb1 public RPC was the only non-lagging endpoint.
    // Infura (+24 blocks), Alchemy (+19 blocks), Ankr (+10 blocks, 1 timeout) all stale.
    // arb1 restored to slot 0 until Arbitrum provider health is revalidated.
    // Do NOT remove this comment or promote authenticated providers without a fresh benchmark.
    // Procurement target for genuine backup: Chainstack or dRPC (not more Infura/Alchemy).
    arbitrum: cleanRpcList([
      process.env.ARBITRUM_MAINNET_RPC_URL,        // slot 0: arb1 public (emergency primary — freshest)
      process.env.ARBITRUM_MAINNET_RPC_URL_1,      // slot 1: Infura  (stale — keep for failover only)
      process.env.ARBITRUM_MAINNET_RPC_URL_2,      // slot 2: Alchemy (stale — keep for failover only)
      process.env.ARBITRUM_MAINNET_RPC_URL_3,      // slot 3: Ankr    (stale — keep for failover only)
    ]),
    // Optimism: Alchemy → Infura (benchmark order)
    optimism: cleanRpcList([
      process.env.OPTIMISM_MAINNET_RPC_URL_1,      // slot 0: Alchemy (benchmark primary)
      process.env.OPTIMISM_MAINNET_RPC_URL,        // slot 1: Infura  (benchmark backup)
    ]),
    // Base: Infura → Alchemy (benchmark order)
    base: cleanRpcList([
      process.env.BASE_MAINNET_RPC_URL_1,          // slot 0: Infura  (benchmark primary)
      process.env.BASE_MAINNET_RPC_URL,            // slot 1: Alchemy (benchmark backup)
    ]),
    // Unichain: Infura only (Alchemy lag confirmed)
    unichain: cleanRpcList([
      process.env.UNICHAIN_MAINNET_RPC_URL_1,      // slot 0: Infura  (benchmark primary)
      process.env.UNICHAIN_MAINNET_RPC_URL,        // slot 1: legacy alias
    ]),
  };

  return RPCS[chainKey] || [];
}

function getChainNetwork(chain) {
  const chainKey = String(chain).toLowerCase();

  const networks = {
    ethereum: ethers.Network.from({ name: 'mainnet', chainId: 1 }),
    arbitrum: ethers.Network.from({ name: 'arbitrum', chainId: 42161 }),
    optimism: ethers.Network.from({ name: 'optimism', chainId: 10 }),
    base: ethers.Network.from({ name: 'base', chainId: 8453 }),
    unichain: ethers.Network.from({ name: 'unichain', chainId: 130 }) // adjust later if needed
  };

  return networks[chainKey] || null;
}

function getProviderKey(chain, url) {
  return `${String(chain).toLowerCase()}::${url}`;
}

function getOrCreateProvider(chain, url) {
  const key = getProviderKey(chain, url);

  if (!_providerCache.has(key)) {
    const network = getChainNetwork(chain);

    _providerCache.set(
      key,
      new ethers.JsonRpcProvider(url, network, {
        staticNetwork: network,
        batchMaxCount: 1
      })
    );
  }

  return _providerCache.get(key);
}

function classifyRpcError(err) {
  if (!err) return 'unknown';
  if (err.code === 'RPC_TIMEOUT') return 'timeout';
  return 'rpc_error';
}

function createProvider(chain) {
  const chainKey = String(chain).toLowerCase();
  const urls = getChainRpcUrls(chainKey);

  if (!urls.length) {
    throw new Error(`Unknown chain: ${chain}`);
  }

  async function callDetailed(label, fn, opts = {}) {
    const timeoutMs = opts.timeoutMs || RPC_CALL_TIMEOUT_MS;
    const hedge = Boolean(opts.hedge);

    let candidates = urls.filter(u => _health.isAvailable(u));

    if (candidates.length === 0) {
      candidates = urls.slice();
    }

    // Trigger background freshness probe if cache is stale (non-blocking).
    _maybeRefreshFreshness(chainKey, urls);

    // Build attempt order: freshness tier first, round-robin within each tier.
    //
    // Problem with sort-then-rotate: rotating the fully-sorted list allows stale
    // endpoints to leapfrog fresh ones based on round-robin offset. e.g. if fresh=[A,B]
    // and stale=[C,D], rotation can produce [C,D,A,B] — stale attempts first.
    //
    // Fix: group by penalty tier → round-robin within the best (lowest) tier only
    // → append worse tiers in ascending penalty order. Fresh endpoints always get
    // first-attempt priority. Equal-freshness endpoints still rotate fairly.
    let rotated;

    if (FRESHNESS_ENABLED && candidates.length > 1) {
      // Group candidates by penalty score
      const groups = new Map();   // penaltyScore → url[]
      for (const url of candidates) {
        const p = getFreshnessPenalty(url);
        if (!groups.has(p)) groups.set(p, []);
        groups.get(p).push(url);
      }

      // Sort groups ascending by penalty (freshest tier first)
      const sortedTiers = [...groups.entries()].sort((a, b) => a[0] - b[0]);

      // Round-robin within the best tier only; append worse tiers as-is
      const [, bestTier] = sortedTiers[0];
      const start = _rrStart[chainKey] || 0;
      const rotatedBest = bestTier.map((_, i) => bestTier[(start + i) % bestTier.length]);
      _rrStart[chainKey] = (start + 1) % bestTier.length;

      const worseTiers = sortedTiers.slice(1).flatMap(([, tier]) => tier);
      rotated = [...rotatedBest, ...worseTiers];

    } else {
      // Freshness disabled or single endpoint — preserve original round-robin behavior
      const start = _rrStart[chainKey] || 0;
      rotated = candidates.map((_, i) => candidates[(start + i) % candidates.length]);
      _rrStart[chainKey] = (start + 1) % candidates.length;
    }

    async function attempt(url, delay = 0) {
      if (delay) {
        await sleep(delay);
      }

      const provider = getOrCreateProvider(chainKey, url);
      const startedAt = Date.now();

      try {
        const result = await withTimeout(
          fn(provider, {
            url,
            endpointId: urls.indexOf(url)
          }),
          timeoutMs,
          `${chainKey}:${label}`
        );

        const duration = Date.now() - startedAt;
        _health.recordSuccess(url, duration);

        // Emit selection event — records which endpoint was actually used.
        const _fe = _freshness.get(url);
        _logEvent({
          ev:         'rpc_select',
          ts:         new Date().toISOString(),
          chain:      chainKey,
          label,
          url:        redactUrl(url),
          lag:        _fe?.lagBlocks    ?? null,
          penalty:    _fe?.penaltyScore ?? 0,
          durationMs: duration,
        });

        return {
          ok: true,
          result,
          meta: {
            url,
            urlRedacted: redactUrl(url),
            endpointId: urls.indexOf(url),
            durationMs: duration
          }
        };
      } catch (err) {
        _health.recordFailure(url);
        // Emit per-attempt failure — records which endpoint failed and why.
        _logEvent({
          ev:        'rpc_attempt_fail',
          ts:        new Date().toISOString(),
          chain:     chainKey,
          label,
          url:       redactUrl(url),
          lag:       _freshness.get(url)?.lagBlocks    ?? null,
          penalty:   _freshness.get(url)?.penaltyScore ?? 0,
          errorCode: err?.code  || null,
          error:     String(err?.message || err).slice(0, 120),
        });
        return {
          ok: false,
          err
        };
      }
    }

    if (hedge && rotated.length >= 2) {
      const first = rotated[0];
      const second = rotated[1];

      const winner = await Promise.race([
        attempt(first),
        attempt(second, RPC_HEDGE_DELAY_MS)
      ]);

      if (winner.ok) {
        return winner;
      }

      const retry = await attempt(second);
      if (retry.ok) {
        return retry;
      }

      _logEvent({
        ev:    'rpc_exhausted',
        ts:    new Date().toISOString(),
        chain: chainKey,
        label,
        mode:  'hedged',
        urls:  [first, second].map(redactUrl),
      });
      throw new Error(`RPC hedged failure (${chainKey}:${label})`);
    }

    for (const url of rotated) {
      const r = await attempt(url);
      if (r.ok) {
        return r;
      }
    }

    _logEvent({
      ev:    'rpc_exhausted',
      ts:    new Date().toISOString(),
      chain: chainKey,
      label,
      mode:  'serial',
      urls:  rotated.map(redactUrl),
    });
    throw new Error(`RPC exhausted (${chainKey}:${label})`);
  }

  async function getBlockNumber(label, opts = {}) {
    const r = await callDetailed(
      label,
      provider => provider.getBlockNumber(),
      opts
    );

    return {
      blockNumber: r.result,
      meta: r.meta
    };
  }

  return {
    callDetailed,
    getBlockNumber,
    urls: urls.slice(),
    chain: chainKey
  };
}

module.exports = {
  createProvider,
  getChainRpcUrls,
  getFreshnessPenalty,   // exposed for diagnostics / telemetry
  _freshness,            // exposed for diagnostics (read-only intent)
};
