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
// URL safety + redaction
// -------------------------
function _sanitizeRpcUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  let u;
  try { u = new URL(s); } catch { return null; }

  const host = String(u.host || '').toLowerCase();
  const pathname = String(u.pathname || '').replace(/\/+$/, '');
  const segs = pathname.split('/').filter(Boolean);

  // Hard block: bare Ankr endpoints like https://rpc.ankr.com/eth (no key)
  // Allow: https://rpc.ankr.com/eth/<KEY>...
  if (host === 'rpc.ankr.com') {
    // If path is exactly "/<chain>" (one segment), it's bare => drop
    if (segs.length === 1) return null;
  }

  return u.toString();
}

function _looksLikeKey(seg) {
  const s = String(seg || '');
  if (!s) return false;
  // Common API key shapes: long hex/base64-ish
  if (s.length >= 16) return true;
  if (/^[a-f0-9]{16,}$/i.test(s)) return true;
  if (/^[a-z0-9_-]{20,}$/i.test(s)) return true;
  return false;
}

function _redactUrl(raw) {
  try {
    const u = new URL(String(raw));
    const segs = String(u.pathname || '').split('/').filter(Boolean);

    // keep only first segment (chain or "v2"), redact anything key-ish after
    // Examples:
    //  - /eth/<KEY>    => /eth/REDACTED
    //  - /v2/<KEY>     => /v2/REDACTED
    //  - /v3/<KEY>/... => /v3/REDACTED
    let outSegs = [];
    if (segs.length >= 1) outSegs.push(segs[0]);

    if (segs.length >= 2) {
      // If segment 2 looks like a key (or we’re in known key-path patterns), redact it
      if (_looksLikeKey(segs[1]) || ['v2', 'v3'].includes(segs[0].toLowerCase()) || segs[0].toLowerCase() === 'eth') {
        outSegs.push('REDACTED');
      } else {
        outSegs.push(segs[1]);
      }
    }

    u.pathname = '/' + outSegs.join('/');
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return 'INVALID_URL';
  }
}

// -------------------------
// Error classification
// -------------------------
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

function isRateLimitError(err) {
  const msg = String(err?.message || '').toLowerCase();
  const val = String(err?.value || '').toLowerCase();

  // IMPORTANT:
  // Do NOT treat ethers code BAD_DATA/SERVER_ERROR as rate limit by itself.
  // Unauthorized errors often arrive wrapped as BAD_DATA.
  return (
    msg.includes('too many requests') ||
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('over rate limit') ||
    (msg.includes('exceeded') && msg.includes('limit')) ||
    val.includes('-32005') ||                    // common “limit exceeded”
    val.includes('too many requests') ||
    val.includes('rate limit') ||
    val.includes('429')
  );
}

function isCallException(err) {
  const code = String(err?.code || '').toUpperCase();
  return code === 'CALL_EXCEPTION';
}

function classifyError(err) {
  // Order matters: AUTH before RATE LIMIT before CALL_EXCEPTION.
  if (isAuthError(err)) return 'auth';
  if (isRateLimitError(err)) return 'rate_limit';
  if (isCallException(err)) return 'call_exception';
  return 'other';
}

// -------------------------
// Config
// -------------------------
const TELEMETRY_FILE = process.env.RPC_TELEMETRY_FILE || 'logs/rpc_telemetry.jsonl';

const DEFAULTS = {
  maxAttempts: Number(process.env.RPC_MAX_ATTEMPTS || 3),
  baseBackoffMs: Number(process.env.RPC_BASE_BACKOFF_MS || 250),
  maxBackoffMs: Number(process.env.RPC_MAX_BACKOFF_MS || 8000),
  jitterMs: Number(process.env.RPC_JITTER_MS || 150),
  cooldownBaseMs: Number(process.env.RPC_COOLDOWN_BASE_MS || 1500),
  cooldownMaxMs: Number(process.env.RPC_COOLDOWN_MAX_MS || 15000),
  minDelayMs: Number(process.env.RPC_MIN_DELAY_MS || 10),
  perChainConcurrency: Number(process.env.RPC_PER_CHAIN_CONCURRENCY || 8),
};

// -------------------------
// RPC URL parsing
// -------------------------
function _splitUrls(s) {
  const raw = String(s || '')
    .split(',')
    .map((x) => String(x || '').trim())
    .filter(Boolean);

  const sanitized = [];
  for (const r of raw) {
    const u = _sanitizeRpcUrl(r);
    if (u) sanitized.push(u);
  }
  return sanitized;
}

function getRpcUrlsForChain(chainKey) {
  const envKey = `${chainKey.toUpperCase()}_RPC_URLS`;
  const urls = _splitUrls(process.env[envKey] || '');
  return urls;
}

// -------------------------
// Provider factory
// -------------------------
function createProvider(chainKey, opts = {}) {
  const chain = String(chainKey || '').toLowerCase();
  const urls = getRpcUrlsForChain(chainKey);

  if (!urls.length) {
    throw new Error(`[provider_factory] No RPC URLs configured for ${chainKey} (env ${chainKey.toUpperCase()}_RPC_URLS empty or all invalid)`);
  }

  const cfg = { ...DEFAULTS, ...(opts || {}) };

  // Build endpoint state
  const endpoints = urls.map((url, i) => ({
    endpointId: i,
    url,
    provider: new ethers.JsonRpcProvider(url, undefined, { batchMaxCount: 1 }),
    disabled: false,
    cooldownUntil: 0,
    failCount: 0,
  }));

  // Emit rpc_init ONCE per provider creation (redacted)
  _appendJsonl(TELEMETRY_FILE, {
    ts: new Date().toISOString(),
    ev: 'rpc_init',
    chain: chainKey.toUpperCase(),
    endpoints: endpoints.map((e) => ({
      endpointId: e.endpointId,
      url: _redactUrl(e.url),
    })),
  });

  // Round-robin pointer
  let rr = 0;

  // Concurrency throttle (simple token bucket)
  let inFlight = 0;

  async function _acquire() {
    while (inFlight >= cfg.perChainConcurrency) {
      await _sleep(_randInt(1, 3));
    }
    inFlight += 1;
  }

  function _release() {
    inFlight = Math.max(0, inFlight - 1);
  }

  function _pickEndpoint() {
    const n = endpoints.length;

    for (let k = 0; k < n; k++) {
      const idx = (rr + k) % n;
      const e = endpoints[idx];
      if (e.disabled) continue;
      if (e.cooldownUntil && e.cooldownUntil > _now()) continue;
      rr = (idx + 1) % n;
      return e;
    }

    // If everything is cooled down, pick the earliest cooldown (still not disabled)
    let best = null;
    for (const e of endpoints) {
      if (e.disabled) continue;
      if (!best || e.cooldownUntil < best.cooldownUntil) best = e;
    }
    return best;
  }

  function _cooldownMsFor(e, kind) {
    if (kind === 'rate_limit') {
      const step = Math.min(e.failCount, 6);
      const ms = Math.min(cfg.cooldownBaseMs * (2 ** step), cfg.cooldownMaxMs);
      return ms + _randInt(0, cfg.jitterMs);
    }
    // small pause for “other” errors
    return Math.min(cfg.cooldownBaseMs, 1500) + _randInt(0, cfg.jitterMs);
  }

  async function _callWithRetry(label, fn) {
    await _acquire();
    try {
      // per-call min delay to avoid bursting
      if (cfg.minDelayMs > 0) {
        await _sleep(cfg.minDelayMs + _randInt(0, cfg.jitterMs));
      }

      for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
        const e = _pickEndpoint();

        if (!e) {
          throw new Error(`[provider_factory] All endpoints disabled for ${chainKey}`);
        }

        try {
          return await fn(e.provider, e.endpointId);
        } catch (err) {
          const kind = classifyError(err);

          // AUTH: immediate disable (no retries, no cooldown)
          if (kind === 'auth') {
            e.disabled = true;
            e.failCount += 1;

            _appendJsonl(TELEMETRY_FILE, {
              ts: new Date().toISOString(),
              ev: 'rpc_fail',
              chain,
              label,
              attempt,
              endpointId: e.endpointId,
              kind,
              disabled: true,
              error: String(err?.message || err),
            });

            // Try next endpoint immediately (do not burn attempts on this endpoint)
            continue;
          }

          // rate_limit / other: cooldown + backoff
          e.failCount += 1;
          const cooldownMs = _cooldownMsFor(e, kind);
          e.cooldownUntil = _now() + cooldownMs;

          _appendJsonl(TELEMETRY_FILE, {
            ts: new Date().toISOString(),
            ev: 'rpc_fail',
            chain,
            label,
            attempt,
            endpointId: e.endpointId,
            kind,
            cooldownMs,
            disabled: false,
            error: String(err?.message || err),
          });

          // Backoff before retry
          const backoff = Math.min(cfg.baseBackoffMs * (2 ** (attempt - 1)), cfg.maxBackoffMs) + _randInt(0, cfg.jitterMs);
          await _sleep(backoff);
        }
      }

      throw new Error(`[provider_factory] Exhausted attempts for ${chainKey}:${label}`);
    } finally {
      _release();
    }
  }

  // Public API used by fetchers
  return {
    chainKey: chainKey.toUpperCase(),

    // generic JSON-RPC request
    request(method, params, label = method) {
      return _callWithRetry(String(label || method), (provider) => provider.send(method, params || []));
    },

    // typed helpers
    getBlockNumber(label = 'eth_blockNumber') {
      return _callWithRetry(label, (provider) => provider.getBlockNumber());
    },

    // Expose callWithRetry for specialized uses
    callWithRetry(label, fn) {
      return _callWithRetry(label, fn);
    },
  };
}
module.exports = {
  createProvider,
  makeFailoverProvider: createProvider,
  getChainRpcUrls,
};
