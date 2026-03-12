/**
 * utils/provider_factory.js
 *
 * Canonical RPC provider layer for AllMight.
 *
 * THIS IS THE ONLY AUTHORIZED PROVIDER SOURCE.
 * All fetchers, quoters, and execution scripts import from here.
 * Do not use utils/rpc_provider.js for new code — it is a compat shim only.
 */

const { ethers } = require('ethers');
const fs   = require('fs');
const path = require('path');

// ── Load .env if not already loaded ──────────────────────────────────────────
(function loadEnv() {
  const p = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) return;
    const [k, ...v] = line.split('=');
    if (!process.env[k.trim()]) process.env[k.trim()] = v.join('=').trim();
  });
})();

// ── Telemetry ────────────────────────────────────────────────────────────────
const TELEMETRY_PATH = path.resolve(__dirname, '../logs/rpc_telemetry.jsonl');

function writeTelemetry(event) {
  try {
    const line = JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n';
    fs.mkdirSync(path.dirname(TELEMETRY_PATH), { recursive: true });
    fs.appendFileSync(TELEMETRY_PATH, line);
  } catch {
    // never crash on telemetry
  }
}

// ── URL sanitizer — blocks bare Ankr endpoints without auth key ─────────────
function sanitizeRpcUrl(url) {
  if (!url) return null;
  url = String(url).trim().replace(/\/$/, '');
  if (!url.startsWith('http')) return null;

  if (url.includes('rpc.ankr.com')) {
    const parts = url.split('/');
    const last = parts[parts.length - 1];
    if (!last || last.length < 40) {
      writeTelemetry({ ev: 'rpc_blocked', reason: 'ankr_no_auth', url: url.slice(0, 60) });
      return null;
    }
  }
  return url;
}

// ── Per-chain RPC endpoint lists ─────────────────────────────────────────────
function getChainRpcUrls(chain) {
  const c = String(chain).toLowerCase().replace(/[- ]/g, '_');

  const maps = {
    ethereum: [
      process.env.ETH_RPC_URL,
      process.env.ETHEREUM_MAINNET_RPC_URL_1,
      process.env.ETHEREUM_MAINNET_RPC_URL_2,
      'https://eth.llamarpc.com',
    ],
    arbitrum: [
      process.env.ARBITRUM_MAINNET_RPC_URL_1,
      process.env.ARBITRUM_MAINNET_RPC_URL_2,
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum.llamarpc.com',
    ],
    optimism: [
      process.env.OPTIMISM_MAINNET_RPC_URL_1,
      process.env.OPTIMISM_MAINNET_RPC_URL,
      'https://mainnet.optimism.io',
      'https://optimism.llamarpc.com',
    ],
    base: [
      process.env.BASE_MAINNET_RPC_URL_1,
      process.env.BASE_MAINNET_RPC_URL,
      'https://mainnet.base.org',
      'https://base.llamarpc.com',
    ],
    unichain: [
      process.env.UNICHAIN_MAINNET_RPC_URL_1,
      process.env.UNICHAIN_MAINNET_RPC_URL,
      'https://mainnet.unichain.org',
    ],
  };

  return (maps[c] || []).map(sanitizeRpcUrl).filter(Boolean);
}

// ── Endpoint health tracker ──────────────────────────────────────────────────
const MAX_FAILS = 3;
const DEMOTION_MS = 5 * 60 * 1000;

class EndpointHealth {
  constructor() {
    this._fails = {};
    this._demotedAt = {};
  }

  isAvailable(url) {
    if (!this._demotedAt[url]) return true;
    const elapsed = Date.now() - this._demotedAt[url];
    if (elapsed > DEMOTION_MS) {
      delete this._demotedAt[url];
      this._fails[url] = 0;
      return true;
    }
    return false;
  }

  recordSuccess(url) {
    this._fails[url] = 0;
    this._demotedAt[url] = 0;
  }

  recordFailure(url) {
    this._fails[url] = (this._fails[url] || 0) + 1;
    if (this._fails[url] >= MAX_FAILS) {
      this._demotedAt[url] = Date.now();
      writeTelemetry({ ev: 'rpc_demoted', url: url.slice(0, 80) });
    }
  }
}

const _health = new EndpointHealth();
const _providerCache = new Map();

// ── Helpers ──────────────────────────────────────────────────────────────────
function redactUrl(url) {
  return String(url)
    .replace(/([a-f0-9]{24,})/ig, 'REDACTED')
    .slice(0, 120);
}

function classifyRpcError(err) {
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('rate')) return 'rate_limit';
  if (msg.includes('429')) return 'http_429';
  if (msg.includes('timeout')) return 'timeout';
  if (msg.includes('network')) return 'network';
  if (msg.includes('socket')) return 'socket';
  if (msg.includes('missing response')) return 'missing_response';
  if (msg.includes('server error')) return 'server_error';
  return 'unknown';
}

function getProviderOptions() {
  return {
    staticNetwork: true,
    batchMaxCount: 1,
  };
}

function getOrCreateProvider(url) {
  if (_providerCache.has(url)) return _providerCache.get(url);
  const provider = new ethers.JsonRpcProvider(url, undefined, getProviderOptions());
  _providerCache.set(url, provider);
  return provider;
}

// ── Core: createProvider(chain) ──────────────────────────────────────────────
function createProvider(chain) {
  const urls = getChainRpcUrls(chain);

  if (urls.length === 0) {
    throw new Error(
      `[provider_factory] No valid RPC URLs for chain "${chain}". ` +
      `Check your .env file for ${String(chain).toUpperCase()}_MAINNET_RPC_URL_1`
    );
  }

  writeTelemetry({
    ev: 'rpc_init',
    chain,
    endpoints: urls.map((url, i) => ({
      endpointId: i,
      url: redactUrl(url),
      batchingDisabled: true,
    })),
  });

  async function callDetailed(label, fn) {
    const available = urls.filter((u) => _health.isAvailable(u));

    if (available.length === 0) {
      writeTelemetry({ ev: 'rpc_all_demoted', chain, label });
      throw new Error(`[provider_factory] All RPC endpoints demoted for chain "${chain}"`);
    }

    for (let i = 0; i < available.length; i++) {
      const url = available[i];
      const provider = getOrCreateProvider(url);
      const t0 = Date.now();

      try {
        const result = await fn(provider, {
          chain,
          url,
          endpointId: urls.indexOf(url),
        });

        _health.recordSuccess(url);
        writeTelemetry({
          ev: 'rpc_select',
          chain,
          label,
          url: redactUrl(url),
          endpointId: urls.indexOf(url),
          durationMs: Date.now() - t0,
        });

        return {
          result,
          meta: {
            chain,
            url,
            urlRedacted: redactUrl(url),
            endpointId: urls.indexOf(url),
            durationMs: Date.now() - t0,
          },
        };
      } catch (err) {
        _health.recordFailure(url);
        writeTelemetry({
          ev: 'rpc_fail',
          chain,
          label,
          url: redactUrl(url),
          endpointId: urls.indexOf(url),
          durationMs: Date.now() - t0,
          errorClass: classifyRpcError(err),
          error: String(err?.message || '').slice(0, 180),
        });
      }
    }

    writeTelemetry({ ev: 'rpc_exhausted', chain, label });
    throw new Error(
      `[provider_factory] All RPC endpoints failed for chain "${chain}", label="${label}"`
    );
  }

  async function call(label, fn) {
    const { result } = await callDetailed(label, async (provider) => fn(provider));
    return result;
  }

  async function getBlockNumber(label = `${chain}.getBlockNumber`) {
    const { result, meta } = await callDetailed(label, async (provider) => {
      return provider.getBlockNumber();
    });
    return { blockNumber: result, meta };
  }

  function provider() {
    const available = urls.filter((u) => _health.isAvailable(u));
    if (available.length === 0) {
      throw new Error(`No healthy endpoints for chain "${chain}"`);
    }
    return getOrCreateProvider(available[0]);
  }

  return {
    call,
    callDetailed,
    getBlockNumber,
    provider,
    urls,
    chain,
  };
}

// ── makeFailoverProvider — legacy alias ──────────────────────────────────────
function makeFailoverProvider(chainOrOpts) {
  const chain = typeof chainOrOpts === 'string'
    ? chainOrOpts.toLowerCase()
    : (chainOrOpts?.chain || 'ethereum').toLowerCase();
  return createProvider(chain);
}

module.exports = {
  createProvider,
  makeFailoverProvider,
  getChainRpcUrls,
};
