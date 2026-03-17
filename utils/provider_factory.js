'use strict';

/*
Provider Factory
----------------
Purpose:
Robust RPC provider manager for AllMight fetchers.

Features:
- endpoint health tracking
- slow endpoint strike system
- failure demotion
- round-robin rotation
- hedged RPC requests
- degraded retry if all endpoints demoted
- explicit static network config per chain
*/

const { ethers } = require('ethers');

const RPC_CALL_TIMEOUT_MS = Number(process.env.RPC_CALL_TIMEOUT_MS || 1500);
const RPC_SLOW_THRESHOLD_MS = Number(process.env.RPC_SLOW_THRESHOLD_MS || 1000);
const RPC_SLOW_STRIKES = Number(process.env.RPC_SLOW_STRIKES || 2);
const MAX_FAILS = Number(process.env.RPC_MAX_FAILS || 3);
const RPC_HEDGE_DELAY_MS = Number(process.env.RPC_HEDGE_DELAY_MS || 250);

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
    // Arbitrum: Infura primary only — Alchemy lag confirmed, no backup yet
    // ACTION REQUIRED: wire ARBITRUM_MAINNET_RPC_URL_1 = Infura key in .env
    arbitrum: cleanRpcList([
      process.env.ARBITRUM_MAINNET_RPC_URL_1,      // slot 0: Infura  (benchmark primary)
      process.env.ARBITRUM_MAINNET_RPC_URL_2,      // slot 1: future backup (Chainstack/dRPC)
      process.env.ARBITRUM_MAINNET_RPC_URL,        // slot 2: legacy alias
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

    const start = _rrStart[chainKey] || 0;
    const rotated = candidates.map((_, i) => candidates[(start + i) % candidates.length]);
    _rrStart[chainKey] = (start + 1) % candidates.length;

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
        _health.recordFailure(url, classifyRpcError(err));
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

      throw new Error(`RPC hedged failure (${chainKey}:${label})`);
    }

    for (const url of rotated) {
      const r = await attempt(url);
      if (r.ok) {
        return r;
      }
    }

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
  getChainRpcUrls
};
