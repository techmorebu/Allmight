'use strict';

/**
 * utils/provider_factory.js
 *
 * Canonical RPC provider layer for AllMight.
 *
 * THIS IS THE ONLY AUTHORIZED PROVIDER SOURCE.
 * All fetchers, quoters, and execution scripts import from here.
 * Do not use utils/rpc_provider.js for new code — it is a compat shim only.
 *
 * What this gives you:
 *   - Per-chain endpoint lists with fallback ordering
 *   - Automatic failover: if endpoint N fails, tries N+1
 *   - Endpoint health scoring: bad endpoints get demoted
 *   - Structured telemetry written to logs/rpc_telemetry.jsonl
 *   - Bare Ankr endpoint blocking (requires auth key)
 *   - One canonical call() interface used by all consumers
 *
 * Usage:
 *   const { createProvider } = require('../utils/provider_factory');
 *   const rpc = createProvider('ethereum');  // or 'arbitrum', 'optimism', 'base'
 *
 *   const result = await rpc.call('my.label', async (provider) => {
 *     const contract = new ethers.Contract(addr, abi, provider);
 *     return contract.someMethod();
 *   });
 *
 * Advanced:
 *   const { makeFailoverProvider } = require('../utils/provider_factory');
 *   const rpc = makeFailoverProvider('ARBITRUM');  // legacy alias
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

// ── Telemetry ─────────────────────────────────────────────────────────────────
const TELEMETRY_PATH = path.resolve(__dirname, '../logs/rpc_telemetry.jsonl');

function writeTelemetry(event) {
  try {
    const line = JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n';
    fs.mkdirSync(path.dirname(TELEMETRY_PATH), { recursive: true });
    fs.appendFileSync(TELEMETRY_PATH, line);
  } catch { /* never crash on telemetry */ }
}

// ── URL sanitizer — blocks bare Ankr endpoints without auth key ───────────────
function sanitizeRpcUrl(url) {
  if (!url) return null;
  url = url.trim().replace(/\/$/, ''); // strip trailing slash
  if (!url.startsWith('http')) return null;

  // Block bare Ankr endpoints — they require an API key
  if (url.includes('rpc.ankr.com')) {
    const parts = url.split('/');
    const last  = parts[parts.length - 1];
    // If last segment looks like a 40+ char API key, it's authenticated — allow
    if (!last || last.length < 40) {
      writeTelemetry({ ev: 'rpc_blocked', reason: 'ankr_no_auth', url: url.slice(0, 40) });
      return null;
    }
  }
  return url;
}

// ── Per-chain RPC endpoint lists ──────────────────────────────────────────────
function getChainRpcUrls(chain) {
  const c = chain.toLowerCase().replace(/[- ]/g, '_');

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

  const raw = maps[c] || [];
  return raw.map(sanitizeRpcUrl).filter(Boolean);
}

// ── Endpoint health tracker ───────────────────────────────────────────────────
const MAX_FAILS   = 3;
const DEMOTION_MS = 5 * 60 * 1000;

class EndpointHealth {
  constructor() {
    this._fails     = {};
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
    this._fails[url]     = 0;
    this._demotedAt[url] = 0;
  }

  recordFailure(url) {
    this._fails[url] = (this._fails[url] || 0) + 1;
    if (this._fails[url] >= MAX_FAILS) {
      this._demotedAt[url] = Date.now();
      writeTelemetry({ ev: 'rpc_demoted', url: url.slice(0, 50) });
    }
  }
}

const _health = new EndpointHealth();

// ── Core: createProvider(chain) ───────────────────────────────────────────────
function createProvider(chain) {
  const urls = getChainRpcUrls(chain);

  if (urls.length === 0) {
    throw new Error(
      `[provider_factory] No valid RPC URLs for chain "${chain}". ` +
      `Check your .env file for ${chain.toUpperCase()}_MAINNET_RPC_URL_1`
    );
  }

  writeTelemetry({
    ev:        'rpc_init',
    chain,
    endpoints: urls.map((url, i) => ({
      endpointId: i,
      url: url.replace(/\/v\d\/[a-zA-Z0-9]{20,}/, '/v2/REDACTED'),
    })),
  });

  async function call(label, fn) {
    const available = urls.filter(u => _health.isAvailable(u));

    if (available.length === 0) {
      writeTelemetry({ ev: 'rpc_all_demoted', chain, label });
      throw new Error(`[provider_factory] All RPC endpoints demoted for chain "${chain}"`);
    }

    for (const url of available) {
      const provider = new ethers.JsonRpcProvider(url);
      try {
        const result = await fn(provider);
        _health.recordSuccess(url);
        writeTelemetry({ ev: 'rpc_select', chain, label, url: url.slice(0, 50) });
        return result;
      } catch (err) {
        _health.recordFailure(url);
        writeTelemetry({
          ev:    'rpc_fail',
          chain,
          label,
          url:   url.slice(0, 50),
          error: err.message?.slice(0, 120),
        });
      }
    }

    writeTelemetry({ ev: 'rpc_exhausted', chain, label });
    throw new Error(
      `[provider_factory] All RPC endpoints failed for chain "${chain}", label="${label}"`
    );
  }

  function provider() {
    const available = urls.filter(u => _health.isAvailable(u));
    if (available.length === 0) throw new Error(`No healthy endpoints for chain "${chain}"`);
    return new ethers.JsonRpcProvider(available[0]);
  }

  return { call, provider, urls, chain };
}

// ── makeFailoverProvider — legacy alias ───────────────────────────────────────
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
