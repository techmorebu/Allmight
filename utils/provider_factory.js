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
// Fix B: Log sampling — write every Nth rpc_select to cut disk I/O.
// Failures, exhausted events, probe_fail are always written (never sampled).
const RPC_LOG_SAMPLE_N = Number(process.env.RPC_LOG_SAMPLE_N || 5);
let _logSelectCounter  = 0;

function _ensureLogDir() {
  try {
    const dir = path.dirname(FRESHNESS_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* silent — never block */ }
}
_ensureLogDir();

function _logEvent(obj) {
  if (!FRESHNESS_LOG_ENABLED) return;
  // Fix B: sample rpc_select events only — failures always written
  if (obj.ev === 'rpc_select') {
    if ((++_logSelectCounter) % RPC_LOG_SAMPLE_N !== 0) return;
  }
  try {
    fs.appendFile(FRESHNESS_LOG_PATH, JSON.stringify(obj) + '\n', () => {});
  } catch { /* fire-and-forget — silent on error */ }
}

const RPC_CALL_TIMEOUT_MS = Number(process.env.RPC_CALL_TIMEOUT_MS || 4000);
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

// Fix B: Per-endpoint minimum probe interval.
// Each endpoint probed at most once per MIN_PROBE_INTERVAL_MS.
// Reduces probe volume ~60-75% without degrading freshness ranking accuracy.
const MIN_PROBE_INTERVAL_MS = Number(process.env.RPC_MIN_PROBE_INTERVAL_MS || 500);
const FRESHNESS_WARNING_BLOCKS  = Number(process.env.RPC_FRESHNESS_WARNING_BLOCKS   || 2);
const FRESHNESS_STALE_BLOCKS    = Number(process.env.RPC_FRESHNESS_STALE_BLOCKS     || 4);
const FRESHNESS_SEVERE_BLOCKS   = Number(process.env.RPC_FRESHNESS_SEVERE_BLOCKS    || 8);
const FRESHNESS_PENALTY_MS      = Number(process.env.RPC_FRESHNESS_PENALTY_MS       || 30000);
const FRESHNESS_WARNING_PENALTY = Number(process.env.RPC_FRESHNESS_WARNING_PENALTY  || 300);
const FRESHNESS_STALE_PENALTY   = Number(process.env.RPC_FRESHNESS_STALE_PENALTY    || 1000);
const FRESHNESS_SEVERE_PENALTY  = Number(process.env.RPC_FRESHNESS_SEVERE_PENALTY   || 3000);

// ── Fix 3: Consecutive-failure hard demotion (Infura rate-limit protection) ───
// When an endpoint accumulates N consecutive call failures (quota/freeze/timeout),
// apply a long cooldown so it stays at the back of rotation until it recovers.
// Env vars (all optional — safe defaults shown):
//   RPC_CONSECUTIVE_FAIL_THRESHOLD=3      failures before hard demotion
//   RPC_CONSECUTIVE_FAIL_COOLDOWN_MS=120000  cooldown duration (default 2 min — E1 Boss ruling 2026-04-24)
//   RPC_CONSECUTIVE_FAIL_PENALTY=10000    score penalty during cooldown
const CONSEC_FAIL_THRESHOLD   = Number(process.env.RPC_CONSECUTIVE_FAIL_THRESHOLD    || 3);
const CONSEC_FAIL_COOLDOWN_MS = Number(process.env.RPC_CONSECUTIVE_FAIL_COOLDOWN_MS  || 120000); // E1: 2min default (was 15min — too long for 2-endpoint setup)
const CONSEC_FAIL_PENALTY     = Number(process.env.RPC_CONSECUTIVE_FAIL_PENALTY      || 10000);

// Per-URL consecutive failure state: { count, coolUntil }
const _consecFail = new Map();

function recordConsecFail(url) {
  const e = _consecFail.get(url) || { count: 0, coolUntil: 0 };
  e.count++;
  if (e.count >= CONSEC_FAIL_THRESHOLD) {
    e.coolUntil = Date.now() + CONSEC_FAIL_COOLDOWN_MS;
    // Push the freshness penalty forward so the endpoint sorts to the back
    const fe = _freshness.get(url);
    if (fe) {
      fe.penaltyScore = Math.max(fe.penaltyScore || 0, CONSEC_FAIL_PENALTY);
      fe.penaltyUntil = Math.max(fe.penaltyUntil || 0, e.coolUntil);
    }
  }
  _consecFail.set(url, e);
}

function recordConsecSuccess(url) {
  const e = _consecFail.get(url);
  if (e) { e.count = 0; _consecFail.set(url, e); }
}

function isInConsecCooldown(url) {
  const e = _consecFail.get(url);
  return !!(e && e.coolUntil > Date.now());
}

// ─── DAILY QUOTA SELF-TRACKER ─────────────────────────────────────────────────
// Tracks call count per URL per UTC day. Resets automatically at midnight UTC.
// No additional RPC calls — piggybacks on the attempt() success path which
// already fires for every real call. Zero extra usage cost.
//
// Daily limits configured in .env (all optional — safe defaults):
//   RPC_DAILY_LIMIT=100000          default for all endpoints
//   RPC_DAILY_LIMIT_infura=100000   override for infura.io endpoints
//   RPC_DAILY_LIMIT_tenderly=100000 override for tenderly.co endpoints
//   (key = last two hostname segments, lowercased, dot replaced with underscore)
//
// Access via getEndpointHealth() → quota field on each endpoint entry.
// Also written to rpc_freshness.jsonl as ev='quota_snapshot' every N calls.

const _DEFAULT_DAILY_LIMIT = Number(process.env.RPC_DAILY_LIMIT || 100000);
const _QUOTA_LOG_EVERY     = Number(process.env.RPC_QUOTA_LOG_EVERY || 100); // log every N calls

// Per-URL quota state: { date: 'YYYY-MM-DD', total: 0, session: 0 }
const _quotaTracker = new Map();

function _utcDate() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// ── Quota seed from rpc_freshness.jsonl ───────────────────────────────────────
// Called once at module load. Scans today's rpc_freshness records to reconstruct
// call counts that would otherwise be lost on process restart.
// Zero extra network calls — reads the local JSONL log only.
// Only counts rpc_select events (actual calls) not probes or failures.
function _seedQuotaFromLog() {
  const today = _utcDate();
  try {
    if (!fs.existsSync(FRESHNESS_LOG_PATH)) return;
    const lines = fs.readFileSync(FRESHNESS_LOG_PATH, 'utf8')
      .split('\n').filter(Boolean);
    const countByUrl = new Map();
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        // Only count rpc_select events from today
        if (r.ev !== 'rpc_select') continue;
        if (!r.ts || !r.ts.startsWith(today)) continue;
        // r.url is already redacted (hostname only) — use as key
        const key = r.url ?? 'unknown';
        countByUrl.set(key, (countByUrl.get(key) ?? 0) + 1);
      } catch { /* skip malformed */ }
    }
    // Seed _quotaTracker using the same redacted URL key that trackQuotaCall uses.
    // When trackQuotaCall fires, it reads from this seeded entry and increments it,
    // so counts survive restarts transparently.
    for (const [redactedUrl, count] of countByUrl) {
      const existing = _quotaTracker.get(redactedUrl);
      if (!existing || existing.date !== today) {
        _quotaTracker.set(redactedUrl, { date: today, total: count, session: 0 });
      } else {
        // Already has some counts (shouldn't happen on fresh load, but be safe)
        existing.total = Math.max(existing.total, count);
      }
    }
    const total = [...countByUrl.values()].reduce((a,b)=>a+b,0);
    if (total > 0) {
      process.stderr.write(
        `[provider_factory] Quota seeded from log: ${total} calls today` +
        ` across ${countByUrl.size} endpoint(s)\n`
      );
    }
  } catch { /* seed is best-effort — never crash on failure */ }
}

function _getDailyLimit(url) {
  // Look for per-provider override: RPC_DAILY_LIMIT_infura, RPC_DAILY_LIMIT_tenderly etc.
  try {
    const parts = new URL(url).hostname.split('.');
    const slug  = parts.slice(-2).join('_').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    const envKey = `RPC_DAILY_LIMIT_${slug}`;
    if (process.env[envKey]) return Number(process.env[envKey]);
  } catch { /* use default */ }
  return _DEFAULT_DAILY_LIMIT;
}

function trackQuotaCall(url) {
  const today    = _utcDate();
  // Use redacted URL (hostname only) as the canonical quota key.
  // This matches what rpc_freshness.jsonl stores, so seeding from log works
  // correctly across process restarts without any un-redaction needed.
  const quotaKey = redactUrl(url);
  const e = _quotaTracker.get(quotaKey) || { date: today, total: 0, session: 0 };

  // Reset daily counter at UTC midnight
  if (e.date !== today) {
    e.date  = today;
    e.total = 0;
    // session counter persists across days (counts for this process lifetime)
  }

  e.total++;
  e.session++;
  _quotaTracker.set(quotaKey, e);

  // Periodic quota snapshot log for correlation analysis
  if (e.total % _QUOTA_LOG_EVERY === 0) {
    const limit     = _getDailyLimit(url);
    const remaining = Math.max(0, limit - e.total);
    const pctUsed   = ((e.total / limit) * 100).toFixed(1);
    _logEvent({
      ev         : 'quota_snapshot',
      ts         : new Date().toISOString(),
      url        : redactUrl(url),
      date       : today,
      callsToday : e.total,
      callsSession: e.session,
      dailyLimit : limit,
      remaining  : remaining,
      pctUsed    : pctUsed,
      resetAt    : today + 'T00:00:00Z (next UTC midnight)',
    });
  }
}

function getQuota(url) {
  const today    = _utcDate();
  const quotaKey = redactUrl(url);
  const e        = _quotaTracker.get(quotaKey)
                ?? _quotaTracker.get('__seeded__' + quotaKey); // also check seed key
  if (!e || e.date !== today) return {
    callsToday: 0, callsSession: e?.session ?? 0,
    remaining: _getDailyLimit(url), pctUsed: '0.0', dailyLimit: _getDailyLimit(url)
  };
  const limit     = _getDailyLimit(url);
  const remaining = Math.max(0, limit - e.total);
  return {
    callsToday  : e.total,
    callsSession: e.session,
    remaining,
    pctUsed     : ((e.total / limit) * 100).toFixed(1),
    dailyLimit  : limit,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function redactUrl(url) {
  // Return hostname only — never expose API keys in logs, Discord, or telemetry.
  // e.g. https://arbitrum.gateway.tenderly.co/SECRET → tenderly.co
  //      https://arbitrum-mainnet.infura.io/v3/SECRET → infura.io
  try {
    const u = new URL(String(url || ''));
    // Last two hostname segments only (provider.tld)
    const parts = u.hostname.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : u.hostname;
  } catch {
    // Fallback: strip scheme and truncate at first /
    return String(url || '').replace(/^https?:\/\//, '').split('/')[0];
  }
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
    // P2: Determine which endpoint is primary (lowest current penalty).
  // Non-primary endpoints (e.g. Infura when Tenderly is healthy) are probed
  // at a much lower frequency to conserve their daily quota.
  // Primary endpoint is always probed normally.
  const _sortedForProbe = urls.slice().sort((a, b) =>
    getFreshnessPenalty(a) - getFreshnessPenalty(b)
  );
  const _primaryProbeUrl = _sortedForProbe[0] ?? null;
  const P2_SECONDARY_PROBE_INTERVAL = Number(process.env.RPC_SECONDARY_PROBE_INTERVAL_MS || 30000); // 30s for non-primary

  const probes = await Promise.allSettled(urls.map(async (url) => {
      // Fix B: skip probe if this endpoint was checked too recently
      const _fe = _freshnessEntry(url);
      const isPrimary = url === _primaryProbeUrl;
      const probeInterval = isPrimary ? MIN_PROBE_INTERVAL_MS : P2_SECONDARY_PROBE_INTERVAL;
      if (Date.now() - (_fe.lastCheckedAt || 0) < probeInterval) {
        return { url, skipped: true };  // P2: non-primary probed much less often
      }
      const provider = getOrCreateProvider(chainKey, url);
      const block    = await withTimeout(
        provider.getBlockNumber(),
        FRESHNESS_PROBE_TIMEOUT,
        `freshness:${chainKey}:${redactUrl(url).slice(0, 20)}`
      );
      return { url, block };
    }));

    const succeeded = probes
      .filter(r => r.status === 'fulfilled' && !r.value.skipped)
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
  // ── PROVIDER SLOT POLICY (Boss ruling 2026-04-17) ──────────────────────────
  //
  // Slot ordering determines fallback priority when freshness scores are equal.
  // Runtime freshness layer overrides static order for lagging endpoints.
  //
  // Intent routing (cheap_read vs critical_read) governs WHICH slots are
  // tried first — premium endpoints are avoided for cheap_read calls.
  //
  // TIER STRUCTURE per chain:
  //   slot 0: Premium-A  — QuickNode (paid, lowest latency target)
  //   slot 1: Premium-B  — Chainstack or Infura (paid, stable backup)
  //   slot 2: Standard   — dRPC or Ankr (free/cheap, acceptable latency)
  //   slot 3: Fallback   — Public RPC (last resort, may lag or rate-limit)
  //
  // _isPremiumUrl() classifies slot 0+1 as premium — cheap_read skips them.
  // dRPC and public RPCs are non-premium — cheap_read hits them first.
  //
  // .env var naming convention:
  //   <CHAIN>_MAINNET_RPC_URL      = slot 0 (primary premium — QuickNode)
  //   <CHAIN>_MAINNET_RPC_URL_1    = slot 1 (secondary premium — Chainstack/Infura)
  //   <CHAIN>_MAINNET_RPC_URL_2    = slot 2 (standard — dRPC/Ankr)
  //   <CHAIN>_MAINNET_RPC_URL_3    = slot 3 (fallback — public RPC)
  //
  // NOTE: *_RPC_URLS comma-lists are NOT read here — only these fixed slots.
  //       ETH_RPC_URL is a legacy alias for ethereum slot 0.
  //
  const RPCS = {

    // ── ETHEREUM MAINNET ──────────────────────────────────────────────────────
    // Active surface: DAI/USDC (UniV3 vs Curve) — watchlist only
    ethereum: cleanRpcList([
      process.env.ETH_RPC_URL                  ||  // slot 0: primary premium (QuickNode / legacy alias)
      process.env.ETHEREUM_MAINNET_RPC_URL,
      process.env.ETHEREUM_MAINNET_RPC_URL_1,       // slot 1: secondary premium (Chainstack / Infura)
      process.env.ETHEREUM_MAINNET_RPC_URL_2,       // slot 2: standard (dRPC)
      process.env.ETHEREUM_MAINNET_RPC_URL_3,       // slot 3: standard (Ankr)
      process.env.ETHEREUM_MAINNET_RPC_URL_4,       // slot 4: secondary premium B (Alchemy)
      process.env.ETHEREUM_MAINNET_RPC_URL_5,       // slot 5: premium C (Infura)
      process.env.ETHEREUM_MAINNET_RPC_URL_6,       // slot 6: public fallback
    ]),

    // ── ARBITRUM MAINNET ──────────────────────────────────────────────────────
    // PRIMARY active chain: ETH/USDC-RAMSES (UniV3 0.01% vs Ramses V2 0.05%)
    //
    // Provider state (Boss ruling 2026-04-20 — RPC benchmark verdict):
    //   Infura = sole approved primary (score 123, lag 0, 100% success)
    //   QuickNode = REJECTED (154 block lag — backend freshness issue, not auth)
    //   Alchemy = REJECTED (stale)
    //   Ankr = REJECTED (stale)
    //   arb1 = REJECTED (stale — block-number sanity only if needed)
    //   Chainstack = REJECTED (stale)
    //   dRPC = REJECTED (stale + 80% eth_call failure)
    //
    // Slot mapping (intent routing: cheap_read avoids premium slots):
    //   0  ARBITRUM_MAINNET_RPC_URL    → Infura (sole primary — critical + cheap reads)
    //   1–6: EMPTY until a second clean endpoint is benchmarked and approved
    //
    // cheap_read: falls through to Infura (only available) — no non-premium pool
    // critical_read / rebuild_sanity / tickmap_scan: Infura only
    //
    // NOTE: Two identical Infura URLs in slots 0+1 share one provider cache instance
    //       (same URL → same cache key) and would waste credits on hedged calls.
    //       Keep slot 1 empty until a distinct second endpoint is approved.
    arbitrum: cleanRpcList([
      process.env.ARBITRUM_MAINNET_RPC_URL,         // slot 0: QuickNode
      process.env.ARBITRUM_MAINNET_RPC_URL_1,       // slot 1: Chainstack
      process.env.ARBITRUM_MAINNET_RPC_URL_2,       // slot 2: dRPC
      process.env.ARBITRUM_MAINNET_RPC_URL_3,       // slot 3: arb1 (public)
      process.env.ARBITRUM_MAINNET_RPC_URL_4,       // slot 4: Ankr
      process.env.ARBITRUM_MAINNET_RPC_URL_5,       // slot 5: Alchemy
      process.env.ARBITRUM_MAINNET_RPC_URL_6,       // slot 6: Infura
    ]),

    // ── OPTIMISM MAINNET ──────────────────────────────────────────────────────
    // Not currently active — provider slots reserved for future surfaces
    optimism: cleanRpcList([
      process.env.OPTIMISM_MAINNET_RPC_URL,         // slot 0: primary premium
      process.env.OPTIMISM_MAINNET_RPC_URL_1,       // slot 1: secondary premium
      process.env.OPTIMISM_MAINNET_RPC_URL_2,       // slot 2: standard
      process.env.OPTIMISM_MAINNET_RPC_URL_3,       // slot 3: public fallback
      process.env.OPTIMISM_MAINNET_RPC_URL_4,       // slot 4: reserved
      process.env.OPTIMISM_MAINNET_RPC_URL_5,       // slot 5: reserved
      process.env.OPTIMISM_MAINNET_RPC_URL_6,       // slot 6: reserved
    ]),

    // ── BASE MAINNET ──────────────────────────────────────────────────────────
    // Not currently active — provider slots reserved for future surfaces
    base: cleanRpcList([
      process.env.BASE_MAINNET_RPC_URL,             // slot 0: primary premium
      process.env.BASE_MAINNET_RPC_URL_1,           // slot 1: secondary premium
      process.env.BASE_MAINNET_RPC_URL_2,           // slot 2: standard
      process.env.BASE_MAINNET_RPC_URL_3,           // slot 3: public fallback
      process.env.BASE_MAINNET_RPC_URL_4,           // slot 4: reserved
      process.env.BASE_MAINNET_RPC_URL_5,           // slot 5: reserved
      process.env.BASE_MAINNET_RPC_URL_6,           // slot 6: reserved
    ]),

    // ── UNICHAIN MAINNET ──────────────────────────────────────────────────────
    // Not currently active — Infura only confirmed; Alchemy lag confirmed
    unichain: cleanRpcList([
      process.env.UNICHAIN_MAINNET_RPC_URL,         // slot 0: Infura (only confirmed provider)
      process.env.UNICHAIN_MAINNET_RPC_URL_1,       // slot 1: reserved
      process.env.UNICHAIN_MAINNET_RPC_URL_2,       // slot 2: reserved
      process.env.UNICHAIN_MAINNET_RPC_URL_3,       // slot 3: reserved
      process.env.UNICHAIN_MAINNET_RPC_URL_4,       // slot 4: reserved
      process.env.UNICHAIN_MAINNET_RPC_URL_5,       // slot 5: reserved
      process.env.UNICHAIN_MAINNET_RPC_URL_6,       // slot 6: reserved
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

// ─── RPC INTENT ROUTER (Boss ruling 2026-04-15) ──────────────────────────────
//
// Intent classes define what kind of read is being performed so the router can
// direct cheap reads away from premium endpoints, reducing credit burn.
//
//   cheap_read      — block polling, low-value status checks
//   critical_read   — pool state reads (slot0/globalState/liquidity)
//   rebuild_sanity  — provider sanity check after rebuild
//   tickmap_scan    — tick-map derivation (spatially critical)
//
// Routing rule:
//   critical_read / rebuild_sanity / tickmap_scan → full pool, premium-first (unchanged)
//   cheap_read → prefer non-premium endpoints (arb1, ankr) over Infura/Alchemy
//
// "Premium" is identified by URL pattern: infura.io or alchemyapi.io/g.alchemy.com
// "Standard" = everything else (Ankr, arb1, etc.)
//
// This does NOT change any gating, timeout, or hedge behaviour.
// It only affects candidate ordering for cheap_read intents.

const INTENT = Object.freeze({
  CHEAP_READ     : 'cheap_read',
  CRITICAL_READ  : 'critical_read',
  REBUILD_SANITY : 'rebuild_sanity',
  TICKMAP_SCAN   : 'tickmap_scan',
});

function _isPremiumUrl(url) {
  // Premium = paid authenticated endpoints that should be reserved for critical reads.
  // cheap_read routing avoids these; critical_read / rebuild_sanity / tickmap_scan use them.
  // Boss ruling 2026-04-17: add QuickNode and Chainstack — they are paid tier, not free fallbacks.
  return /infura\.io|alchemyapi\.io|g\.alchemy\.com|quiknode\.pro|chainstack\.com|p2pify\.com/i.test(url);
}

// ─── SESSION REQUEST COUNTERS ─────────────────────────────────────────────────
// In-process counters reset per process lifetime. Emitted in rpc_usage_summary.

const _intentCounters = {
  cheap_read     : { attempts: 0, failures: 0, premiumHits: 0, cheapHits: 0 },
  critical_read  : { attempts: 0, failures: 0, premiumHits: 0, cheapHits: 0 },
  rebuild_sanity : { attempts: 0, failures: 0, premiumHits: 0, cheapHits: 0 },
  tickmap_scan   : { attempts: 0, failures: 0, premiumHits: 0, cheapHits: 0 },
  unclassified   : { attempts: 0, failures: 0, premiumHits: 0, cheapHits: 0 },
};

function _intentKey(intent) {
  return _intentCounters[intent] ? intent : 'unclassified';
}

function _countAttempt(intent, url, success) {
  const k = _intentKey(intent);
  _intentCounters[k].attempts++;
  if (!success) _intentCounters[k].failures++;
  if (_isPremiumUrl(url)) _intentCounters[k].premiumHits++;
  else                    _intentCounters[k].cheapHits++;
}

/**
 * Get a snapshot of intent-level request counters.
 * Used by activator to emit rpc_usage_summary at session end.
 */
function getIntentCounters() {
  const snap = {};
  for (const [k, v] of Object.entries(_intentCounters)) {
    snap[k] = { ...v };
  }
  return snap;
}

// Estimate Infura credit cost: 1 credit per call for eth_blockNumber,
// 2 credits for eth_call (pool reads). Rough heuristic only.
function estimateCreditCost(counters) {
  const blockCredits  = (counters.cheap_read?.premiumHits     ?? 0) * 1;
  const poolCredits   = (counters.critical_read?.premiumHits  ?? 0) * 2;
  const rebuildCredits= (counters.rebuild_sanity?.premiumHits ?? 0) * 2;
  const tickmapCredits= (counters.tickmap_scan?.premiumHits   ?? 0) * 2;
  return { blockCredits, poolCredits, rebuildCredits, tickmapCredits,
           total: blockCredits + poolCredits + rebuildCredits + tickmapCredits };
}

// ─── END INTENT ROUTER CONSTANTS ─────────────────────────────────────────────

function createProvider(chain) {
  const chainKey = String(chain).toLowerCase();
  const urls = getChainRpcUrls(chainKey);

  if (!urls.length) {
    throw new Error(`Unknown chain: ${chain}`);
  }

  async function callDetailed(label, fn, opts = {}) {
    const timeoutMs = opts.timeoutMs || RPC_CALL_TIMEOUT_MS;
    const hedge = Boolean(opts.hedge);
    const intent = opts.intent || INTENT.CRITICAL_READ;   // default: treat as critical

    let candidates = urls.filter(u => _health.isAvailable(u));

    if (candidates.length === 0) {
      // E2: All endpoints are demoted or in cooldown — no route would be worse
      // than having NO route. Use the least-bad endpoint (lowest freshness penalty)
      // rather than letting the call fail immediately.
      // Sort by penalty + consecutive-fail cooldown so the healthiest degraded
      // endpoint leads. This is a last-resort path only.
      candidates = urls.slice().sort((a, b) => {
        const aP = getFreshnessPenalty(a) + (isInConsecCooldown(a) ? CONSEC_FAIL_PENALTY * 2 : 0);
        const bP = getFreshnessPenalty(b) + (isInConsecCooldown(b) ? CONSEC_FAIL_PENALTY * 2 : 0);
        return aP - bP;
      });
    }

    // ── Fix C: Primary-only routing with cold failover ───────────────────────
    // Boss ruling 2026-04-24: "More endpoints = more reads = faster rate-limit"
    // Normal path: route ALL traffic to the primary endpoint only.
    // Secondary endpoints are cold failover — only promoted when primary fails.
    //
    // Primary  = candidates[0] after freshness sort (lowest penalty = freshest)
    // Secondary = candidates[1..N] — held back unless primary is exhausted
    //
    // This cuts probe-and-call volume from N*reads to 1*reads per tick.
    // Secondary endpoints are still probed for freshness (so failover works instantly)
    // but they do NOT receive traffic unless the primary call fails.
    //
    // Disable via RPC_PRIMARY_ONLY=false (falls back to old round-robin rotation).
    const PRIMARY_ONLY = process.env.RPC_PRIMARY_ONLY !== 'false';

    // ── Intent-based candidate reordering ───────────────────────────────────
    // For cheap_read: prefer non-premium endpoints to reduce credit burn.
    // For all other intents: use normal freshness-tier ordering (premium first).
    if (intent === INTENT.CHEAP_READ && candidates.length > 1) {
      const cheap   = candidates.filter(u => !_isPremiumUrl(u));
      const premium = candidates.filter(u =>  _isPremiumUrl(u));
      if (cheap.length > 0) {
        candidates = [...cheap, ...premium];
      }
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
        // Fix 3: add consecutive-fail penalty on top of freshness penalty
        const p = getFreshnessPenalty(url) + (isInConsecCooldown(url) ? CONSEC_FAIL_PENALTY * 2 : 0);
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
        _countAttempt(intent, url, true);   // intent counter — success
        recordConsecSuccess(url);           // Fix 3: reset consecutive fail counter
        trackQuotaCall(url);               // Quota: count this call toward daily total

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
        _countAttempt(intent, url, false);   // intent counter — failure
        recordConsecFail(url);              // Fix 3: track consecutive failures → long demotion
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

    // P2 (Boss ruling 2026-04-26): Strict primary-only routing.
    // Tenderly = PRIMARY (100% of normal traffic).
    // Infura   = COLD FAILOVER ONLY — never in normal rotation.
    //
    // Failover activates ONLY when:
    //   a) primary call times out or errors (attempt() failure path below)
    //   b) primary is in consecutive-fail cooldown
    // Infura is NEVER used for:
    //   - freshness probing (P2_SECONDARY_PROBE_INTERVAL handles this above)
    //   - parallel reads (hedge is failure-gated via CS1)
    //   - normal rotation
    //
    // rotated[0] = freshest endpoint (Tenderly when healthy).
    let primaryCandidate = rotated[0];
    let failoverCandidates = rotated.slice(1);
    const effectiveCandidates = (PRIMARY_ONLY && rotated.length > 1)
      ? [primaryCandidate]           // P2: primary only — Infura held as cold reserve
      : rotated;                     // RPC_PRIMARY_ONLY=false: override for debugging

    // Call-save 1: Failure-gated hedging
    // Hedge only when the primary endpoint shows recent distress:
    //   - consecutive fail count > 0 (at least one recent failure), OR
    //   - primary is in consecutive-fail cooldown
    // When primary is healthy, a hedge doubles calls for no reliability gain.
    // Disable gate via RPC_HEDGE_ALWAYS=true to restore old always-hedge behaviour.
    const primaryUrl          = rotated[0];
    const primaryCfState      = _consecFail.get(primaryUrl) || { count: 0, coolUntil: 0 };
    const primaryNeedsHedge   = primaryCfState.count > 0 || primaryCfState.coolUntil > Date.now();
    const hedgeAlways         = process.env.RPC_HEDGE_ALWAYS === 'true';
    const shouldHedge         = hedge && rotated.length >= 2 && (hedgeAlways || primaryNeedsHedge);

    if (shouldHedge) {
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

    // Fix C: Serial loop — try primary first, then failover if primary fails
    for (const url of effectiveCandidates) {
      const r = await attempt(url);
      if (r.ok) return r;
    }
    // Primary failed — try failover candidates if any exist
    if (PRIMARY_ONLY && failoverCandidates.length > 0) {
      for (const url of failoverCandidates) {
        const r = await attempt(url);
        if (r.ok) return r;
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
      { intent: INTENT.CHEAP_READ, ...opts }   // block polling = cheap_read by default
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

// ── Seed quota tracker from today's log on startup ───────────────────────────
// Reconstructs call counts lost to process restart. Best-effort, never crashes.
_seedQuotaFromLog();

// ─── PER-ENDPOINT HEALTH SNAPSHOT ────────────────────────────────────────────
// Returns live health metrics for every URL configured for a given chain.
// Generic — works for any number of endpoints, any provider.
// Used by activator heartbeat and notification router to monitor all endpoints
// equally, not just the primary. Add any endpoint to .env and it appears here.
//
// Fields per endpoint:
//   url        — redacted (host only, no API key)
//   role       — 'primary' | 'failover' (based on freshness-sorted rank)
//   lagBlocks  — block lag vs best seen endpoint (0 = at chain head)
//   penalty    — current freshness penalty score (0 = clean)
//   inCooldown — true if consecutive-fail cooldown is active
//   consecFails— number of consecutive failures before last success
//   fails      — raw fail count from health manager (resets on success)
//   demoted    — true if health manager has demoted this endpoint
//   lastChecked— ms since last freshness probe (null if never probed)
function getEndpointHealth(chainKey) {
  const urls = getChainRpcUrls(String(chainKey).toLowerCase());
  if (!urls.length) return [];

  const now = Date.now();

  // Sort by freshness penalty to determine primary/failover role
  const sorted = urls.slice().sort((a, b) => {
    const aP = getFreshnessPenalty(a) + (isInConsecCooldown(a) ? CONSEC_FAIL_PENALTY * 2 : 0);
    const bP = getFreshnessPenalty(b) + (isInConsecCooldown(b) ? CONSEC_FAIL_PENALTY * 2 : 0);
    return aP - bP;
  });

  return sorted.map((url, idx) => {
    const fe   = _freshness.get(url) || {};
    const he   = _health.map.get(url) || { fails: 0, demoted: false };
    const cf   = _consecFail.get(url) || { count: 0, coolUntil: 0 };
    const inCd = cf.coolUntil > now;

    const quota = getQuota(url);
    return {
      url         : redactUrl(url),
      role        : idx === 0 ? 'primary' : 'failover',
      lagBlocks   : fe.lagBlocks    ?? null,
      penalty     : fe.penaltyScore ?? 0,
      inCooldown  : inCd,
      consecFails : cf.count,
      cooldownMs  : inCd ? Math.max(0, cf.coolUntil - now) : 0,
      fails       : he.fails,
      demoted     : he.demoted,
      lastChecked : fe.lastCheckedAt ? Math.round((now - fe.lastCheckedAt) / 1000) + 's ago' : null,
      lastBlock   : fe.lastBlock ?? null,
      // Quota self-tracking — piggybacks on existing calls, zero extra cost
      quota       : {
        callsToday  : quota.callsToday,
        callsSession: quota.callsSession,
        remaining   : quota.remaining,
        pctUsed     : quota.pctUsed,
        dailyLimit  : quota.dailyLimit,
        nearLimit   : quota.remaining < (quota.dailyLimit * 0.1), // true when <10% remains
      },
    };
  });
}

module.exports = {
  createProvider,
  getChainRpcUrls,
  getFreshnessPenalty,   // exposed for diagnostics / telemetry
  _freshness,            // exposed for diagnostics (read-only intent)
  INTENT,
  getIntentCounters,
  estimateCreditCost,
  getEndpointHealth,
};
