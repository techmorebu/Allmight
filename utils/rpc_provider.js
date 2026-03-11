'use strict';

/**
 * utils/rpc_provider.js
 *
 * COMPATIBILITY SHIM — DO NOT USE FOR NEW CODE.
 *
 * Re-exports from utils/provider_factory.js to prevent import errors
 * in fetchers not yet migrated to the canonical provider layer.
 *
 * Delete this file once all fetchers import from provider_factory.js directly.
 */

const {
  createProvider,
  makeFailoverProvider,
  getChainRpcUrls,
} = require('./provider_factory');

function makeProviderFromEnv(opts = {}) {
  const chain = opts.chain || 'ethereum';
  return createProvider(chain).provider();
}

module.exports = {
  createProvider,
  makeFailoverProvider,
  makeProviderFromEnv,
  getChainRpcUrls,
};
