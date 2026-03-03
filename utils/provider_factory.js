'use strict';

/**
 * utils/provider_factory.js
 *
 * Canonical RPC entry point for ALL fetchers.
 *
 * Design goals:
 * - Deterministic endpoint rotation
 * - Per-endpoint cooldown on failure (rate-limit aware)
 * - Exponential backoff + jitter
 * - Batch disabled by default (ethers v6 batchMaxCount=1)
 * - Per-chain concurrency + inter-call throttle (minDelay + jitter)
 * - Structured telemetry (JSONL)
 *
 * Rule: No fetcher creates its own JsonRpcProvider again.
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// -------------------------
// Helpers
// -------------------------
function _now() { return Date.now(); }

function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function _randInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function _ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (_) {}
}

function _appendJsonl(filePath, obj) {
  try {
    _ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, JSON.stringify(obj) + '\n', { encoding: 'utf8' });
  } catch (_) {}
}

// -------------------------
// Error classification
// -------------------------
function isRateLimitError(err) {
  const msg = String(err?.message || '').toLowerCase();
  const code = err?.code;
  const val = String(err?.value || '').toLowerCase();
  // vendor-specific fragments commonly seen through ethers
  return (
    msg.includes('too many requests') ||
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('over rate limit') ||
    msg.includes('exceeded') && msg.includes('limit') ||
    val.includes('-32005') ||
    val.includes('too many requests') ||
    code === 'SERVER_ERROR' ||
    code === 'BAD_DATA'
  );
}

function isAuthError(err) {
  const msg = String(err?.message || '').toLowerCase();
  const val = String(err?.value || '').toLowerCase();
  return (
    msg.includes('unauthorized') ||
    msg.includes('authenticate') ||
    msg.includes('api key') ||
    msg.includes('forbidden') ||
    msg.includes('access denied') ||
    val.includes('unauthorized') ||
    val.includes('api key')
  );
}

function classifyError(err) {
  const msg = String(err?.message || '').toLowerCase();
  if (isRateLimitError(err)) return 'rate_limit';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  if (msg.includes('network') || msg.includes('socket') || msg.includes('econnreset')) return 'network';
  return 'other';
}

// -------------------------
// URL parsing
// -------------------------
function _splitUrls(s) {
  return (s || '')
    .split(/[,\s]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function _chainToPrefixes(chain) {
  // Canonical env prefix + legacy ones.
  const c = String(chain || '').toLowerCase();
  if (c === 'ethereum' || c === 'eth') return ['ETHEREUM', 'ETH'];
  if (c === 'arbitrum' || c === 'arb') return ['ARBITRUM', 'ARB'];
  if (c === 'optimism' || c === 'op') return ['OPTIMISM', 'OP'];
  if (c === 'base') return ['BASE'];
  if (c === 'unichain') return ['UNICHAIN'];
  return [c.toUpperCase()];
}

function _getUrlsFromChainRpcUrlsJson(chain) {
  // Optional: CHAIN_RPC_URLS can be:
  // - JSON object: {"ethereum":[...],"base":"url1,url2",...}
  // - JSON array: [{"chain":"ethereum","urls":[...]}]
  // - simple "ethereum=url1,url2;base=url3" (legacy-ish)
  const raw = (process.env.CHAIN_RPC_URLS || '').trim();
  if (!raw) return [];

  // JSON forms
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      const c = String(chain || '').toLowerCase();

      if (Array.isArray(parsed)) {
        const hit = parsed.find((x) => String(x?.chain || '').toLowerCase() === c);
        if (!hit) return [];
        if (Array.isArray(hit.urls)) return hit.urls.map(String).map((s) => s.trim()).filter(Boolean);
        if (typeof hit.urls === 'string') return _splitUrls(hit.urls);
        return [];
      }

      if (parsed && typeof parsed === 'object') {
        const v = parsed[c] ?? parsed[c.toUpperCase()];
        if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
        if (typeof v === 'string') return _splitUrls(v);
      }
    } catch (_) {
      return [];
    }
    return [];
  }

  // "ethereum=url1,url2;base=url3"
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
  const c = String(chain || '').toLowerCase();
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (!k || !v) continue;
    if (k.trim().toLowerCase() === c) return _splitUrls(v);
  }
  return [];
}

function getChainRpcUrls(chain) {
  // 1) CHAIN_RPC_URLS (multi-chain mapping)
  const fromJson = _getUrlsFromChainRpcUrlsJson(chain);
  if (fromJson.length) return fromJson;

  // 2) <PREFIX>_RPC_URLS / <PREFIX>_RPC_URL
  const prefixes = _chainToPrefixes(chain);
  for (const prefix of prefixes) {
    const urls = _splitUrls(process.env[`${prefix}_RPC_URLS`]);
    const single = (process.env[`${prefix}_RPC_URL`] || '').trim();
    if (urls.length) return urls;
    if (single) return [single];
  }

  // 3) Legacy <PREFIX>_MAINNET_RPC_URL_1..9
  for (const prefix of prefixes) {
    const legacy = [];
    for (let i = 1; i <= 9; i++) {
      const v = (process.env[`${prefix}_MAINNET_RPC_URL_${i}`] || '').trim();
      if (v) legacy.push(v);
    }
    if (legacy.length) return legacy;
  }

  return [];
}

// -------------------------
// Limiter (per-chain)
// -------------------------
function createLimiter({ maxConcurrent, minDelayMs, jitterMs }) {
  const cfg = {
    maxConcurrent: Math.max(1, Number(maxConcurrent || 1)),
    minDelayMs: Math.max(0, Number(minDelayMs || 0)),
    jitterMs: Math.max(0, Number(jitterMs || 0)),
  };

  let active = 0;
  let lastStartAt = 0;
  const queue = [];

  async function _drain() {
    if (active >= cfg.maxConcurrent) return;
    const item = queue.shift();
    if (!item) return;

    const now = _now();
    const jitter = cfg.jitterMs ? _randInt(0, cfg.jitterMs) : 0;
    const earliest = lastStartAt + cfg.minDelayMs + jitter;
    const waitMs = Math.max(0, earliest - now);

    active += 1;
    lastStartAt = now + waitMs;

    try {
      if (waitMs > 0) await _sleep(waitMs);
      const out = await item.fn();
      item.resolve(out);
    } catch (e) {
      item.reject(e);
    } finally {
      active -= 1;
      setImmediate(_drain);
    }
  }

  function schedule(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      setImmediate(_drain);
    });
  }

  function snapshot() {
    return { ...cfg, active, queued: queue.length };
  }

  return { schedule, snapshot };
}

// -------------------------
// Provider factory (canonical)
// -------------------------
function _defaultChainTuning(chain) {
  const c = String(chain || '').toLowerCase();
  // Conservative defaults tuned for stability.
  if (c === 'ethereum' || c === 'eth') {
    return { maxConcurrent: 1, minDelayMs: 160, jitterMs: 60 };
  }
  // L2s
  return { maxConcurrent: 2, minDelayMs: 120, jitterMs: 60 };
}

function createProvider(chain, opts = {}) {
  const urls = getChainRpcUrls(chain);
  if (!urls.length) {
    throw new Error(`No RPC URLs configured for chain=${chain}. Set CHAIN_RPC_URLS or ${_chainToPrefixes(chain)[0]}_RPC_URLS.`);
  }

  const tuning = { ..._defaultChainTuning(chain), ...(opts.tuning || {}) };
  const limiter = createLimiter(tuning);

  const logFile =
    opts.logFile ||
    process.env.RPC_TELEMETRY_LOG_FILE ||
    path.resolve(process.cwd(), 'logs', 'rpc_telemetry.jsonl');

  // endpoint states
  const endpoints = urls.map((url, i) => ({
    id: i,
    url,
    disabled: false,
    disabledReason: null,
    coolUntil: 0,
    ok: 0,
    fail: 0,
    consecutiveFail: 0,
    lastError: null,
    lastOkAt: null,
  }));

  let rr = 0; // round-robin cursor

  function _pickEndpoint() {
    const n = endpoints.length;
    const start = rr;
    const now = _now();

    for (let k = 0; k < n; k++) {
      const idx = (start + k) % n;
      if (!endpoints[idx].disabled && endpoints[idx].coolUntil <= now) {
        rr = (idx + 1) % n;
        return endpoints[idx];
      }
    }

    // none available: pick soonest coolUntil among non-disabled and wait
    const live = endpoints.filter((e) => !e.disabled);
    if (!live.length) {
      throw new Error(`All RPC endpoints are disabled for chain=${chain}. Check API keys / env.`);
    }
    let best = live[0];
    for (const e of live) {
      if (e.coolUntil < best.coolUntil) best = e;
    }
    rr = (best.id + 1) % n;
    return best;
  }

  function _cooldownMs(kind, consecutiveFail, baseMsOverride) {
    if (kind === 'auth') return 24 * 60 * 60 * 1000; // 24h
    const base = Number(baseMsOverride || 0) || (kind === 'rate_limit' ? 1500 : 300);
    const exp = Math.min(6, Math.max(0, consecutiveFail)); // cap exponent
    const jitter = _randInt(0, 250);
    const ms = Math.min(30000, base * Math.pow(2, exp) + jitter);
    return ms;
  }

  function _makeEthersProvider(url) {
    // Batch disabled by default.
    const batchMaxCount = opts.batchMaxCount ?? 1;
    const batchStallTime = opts.batchStallTime ?? 0;
    return new ethers.JsonRpcProvider(url, undefined, { batchMaxCount, batchStallTime });
  }

  async function call(label, fn, callOpts = {}) {
    const attempts = Math.max(1, Number(callOpts.attempts || 4));

    return limiter.schedule(async () => {
      const startedAt = _now();
      let lastErr;

      for (let a = 1; a <= attempts; a++) {
        const ep = _pickEndpoint();
        const now = _now();
        if (ep.coolUntil > now) {
          const wait = Math.max(0, ep.coolUntil - now);
          _appendJsonl(logFile, {
            ts: new Date().toISOString(),
            ev: 'rpc_wait_cooldown',
            chain,
            label,
            endpointId: ep.id,
            waitMs: wait,
          });
          await _sleep(wait);
        }

        const provider = _makeEthersProvider(ep.url);

        _appendJsonl(logFile, {
          ts: new Date().toISOString(),
          ev: 'rpc_attempt',
          chain,
          label,
          attempt: a,
          endpointId: ep.id,
          limiter: limiter.snapshot(),
        });

        try {
          const timeoutMs = Math.max(1000, Number(callOpts.timeoutMs || 12000));
          const out = await Promise.race([
            fn(provider, ep.url),
            new Promise((_, rej) => setTimeout(() => rej(new Error(`rpc_timeout after ${timeoutMs}ms`)), timeoutMs)),
          ]);
          ep.ok += 1;
          ep.consecutiveFail = 0;
          ep.lastOkAt = new Date().toISOString();

          _appendJsonl(logFile, {
            ts: new Date().toISOString(),
            ev: 'rpc_ok',
            chain,
            label,
            attempt: a,
            endpointId: ep.id,
            ms: _now() - startedAt,
          });
          return out;
        } catch (e) {
          lastErr = e;
          const kind = classifyError(e);
          ep.fail += 1;

          if (kind === 'auth') {
            ep.disabled = true;
            ep.disabledReason = 'auth';
          }
          ep.consecutiveFail += 1;
          ep.lastError = { kind, message: String(e?.message || e) };

          const cd = _cooldownMs(kind, ep.consecutiveFail, callOpts.baseCooldownMs);
          ep.coolUntil = _now() + cd;

          _appendJsonl(logFile, {
            ts: new Date().toISOString(),
            ev: 'rpc_fail',
            chain,
            label,
            attempt: a,
            endpointId: ep.id,
            kind,
            cooldownMs: cd,
            disabled: ep.disabled,
            error: String(e?.message || e),
          });

          // brief inter-attempt backoff (also jittered)
          const inter = Math.min(2000, 150 * a + _randInt(0, 150));
          await _sleep(inter);
        }
      }

      throw lastErr;
    });
  }

  function stats() {
    return {
      chain,
      tuning,
      endpoints: endpoints.map((e) => ({
        id: e.id,
        url: e.url,
        disabled: e.disabled,
        disabledReason: e.disabledReason,
        coolUntil: e.coolUntil,
        ok: e.ok,
        fail: e.fail,
        consecutiveFail: e.consecutiveFail,
        lastError: e.lastError,
        lastOkAt: e.lastOkAt,
      })),
      limiter: limiter.snapshot(),
    };
  }

  return { chain, call, stats, getUrls: () => urls.slice() };
}

module.exports = { createProvider, getChainRpcUrls };
