'use strict';

/**
 * utils/rpc_provider.js
 *
 * ⚠️  COMPATIBILITY SHIM — DO NOT USE FOR NEW CODE ⚠️
 *
 * This file re-exports from utils/provider_factory.js.
 * It exists only to prevent import errors in code that hasn't been
 * migrated to the canonical provider layer yet.
 *
 * Migration status:
 *   [ ] sushiswapFetcher.js   — patched (uses createProvider)
 *   [ ] uniswapV3Fetcher.js   — needs audit
 *   [ ] arbitrumFetcher.js    — needs audit
 *   [ ] baseFetcher.js        — needs audit
 *   [ ] optimismFetcher.js    — needs audit
 *   [ ] curveFetcherArbitrum  — needs audit
 *   [ ] balancerFetcherArbitrum — needs audit
 *
 * Once all fetchers import from provider_factory.js directly,
 * delete this file.
 */

const {
  createProvider,
  makeFailoverProvider,
  getChainRpcUrls,
} = require('./provider_factory');

// Legacy export that older code was trying to call
function makeProviderFromEnv(opts = {}) {
  const chain = opts.chain || 'ethereum';
  return createProvider(chain).provider();
}

module.exports = {
  createProvider,
  makeFailoverProvider,
  makeProviderFromEnv,   // legacy
  getChainRpcUrls,
};
