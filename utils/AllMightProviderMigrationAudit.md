# AllMight Provider Migration Audit
# Generated: 2026-03-11
# Purpose: Classify every raw JsonRpcProvider instantiation for migration to provider_factory.js

## STATUS KEY
# [DONE]    Already patched to use createProvider()
# [ACTIVE]  Live production code — needs migration
# [LEGACY]  Old/experimental file — migrate or archive
# [OK]      Authorized exception (test/deploy script, not a fetcher)

---

## COMPLETED

[DONE] scripts/data_collection/masterFetcher/sushiswapFetcher.js
  - Was: new ethers.JsonRpcProvider(process.env.ETH_RPC_URL || 'https://eth.llamarpc.com')
  - Now: createProvider('ethereum') + rpc.call(...)
  - Chain: ethereum

---

## ACTIVE — NEEDS MIGRATION (priority order)

[ACTIVE] scripts/data_collection/masterFetcher/arbitrumFetcher.js:14
  - Was: new ethers.JsonRpcProvider(process.env.ARBITRUM_MAINNET_RPC_URL_1 || 'https://arb1.arbitrum.io/rpc')
  - Fix:  const rpc = createProvider('arbitrum')  then rpc.call(...)
  - Chain: arbitrum
  - Priority: HIGH — Arbitrum is primary execution chain

[ACTIVE] scripts/data_collection/masterFetcher/curveFetcherArbitrum.js:13
  - Was: new ethers.JsonRpcProvider(process.env.ARBITRUM_MAINNET_RPC_URL_1 || ...)
  - Fix:  const rpc = createProvider('arbitrum')  then rpc.call(...)
  - Chain: arbitrum
  - Priority: HIGH — Curve is a primary arbitrage venue

[ACTIVE] scripts/data_collection/masterFetcher/balancerFetcherArbitrum.js:11
  - Was: new ethers.JsonRpcProvider(RPC_URL)  [ARBITRUM]
  - Fix:  const rpc = createProvider('arbitrum')  then rpc.call(...)
  - Chain: arbitrum
  - Priority: MEDIUM

[ACTIVE] scripts/data_collection/masterFetcher/uniswapV3Fetcher.js:7
  - Was: new ethers.JsonRpcProvider(process.env.ETH_RPC_URL || 'https://eth.llamarpc.com')
  - Fix:  const rpc = createProvider('ethereum')  then rpc.call(...)
  - Chain: ethereum
  - Priority: MEDIUM

[ACTIVE] scripts/data_collection/masterFetcher/baseFetcher.js:14
  - Was: new ethers.JsonRpcProvider(process.env.BASE_MAINNET_RPC_URL_1 || ...)
  - Fix:  const rpc = createProvider('base')  then rpc.call(...)
  - Chain: base
  - Priority: LOW (future chain)

[ACTIVE] scripts/data_collection/masterFetcher/optimismFetcher.js:17
  - Was: new ethers.JsonRpcProvider(process.env.OPTIMISM_MAINNET_RPC_URL_1 || ...)
  - Fix:  const rpc = createProvider('optimism')  then rpc.call(...)
  - Chain: optimism
  - Priority: LOW (future chain)

[ACTIVE] scripts/data_collection/masterFetcher/unichainFetcher.js:15
  - Was: new ethers.JsonRpcProvider(RPC_URL)  [UNICHAIN]
  - Fix:  const rpc = createProvider('unichain')  then rpc.call(...)
  - Chain: unichain
  - Priority: LOW (experimental chain)

---

## LEGACY / SPECIAL CASES

[LEGACY] scripts/HybridArbitrage.js:47
  - Was: new ethers.JsonRpcProvider(process.env.ETH_RPC_URL)
  - This is an older/experimental arbitrage script
  - Action: Migrate or archive — do not run in production until migrated

[OK] scripts/execution/execute_trade.js:177
  - Was: new ethers.JsonRpcProvider(rpc)  inside connectProvider() fallback
  - This is the execution layer — has its own RPC rotation logic
  - Action: Review against canonical layer but not urgent — execution path
    is separate from fetcher path. Migrate in Phase C per senior dev's plan.

[OK] scripts/interact.js:7
  - Was: new ethers.JsonRpcProvider(process.env.ETHEREUM_TESTNET_SEPOLIA_RPC_URL)
  - This is a dev/test interaction script, not production
  - Action: Low priority — leave as-is or migrate later

---

## MIGRATION PATTERN

Standard migration for any fetcher:

BEFORE:
  const PROVIDER = new ethers.JsonRpcProvider(process.env.ARBITRUM_MAINNET_RPC_URL_1 || fallback);
  ...
  const contract = new ethers.Contract(addr, abi, PROVIDER);
  const result = await contract.method();

AFTER:
  const { createProvider } = require('../../../utils/provider_factory');
  const rpc = createProvider('arbitrum');
  ...
  const result = await rpc.call('descriptive.label', async (provider) => {
    const contract = new ethers.Contract(addr, abi, provider);
    return contract.method();
  });

---

## FILES TO DEPLOY

  utils/provider_factory.js     <- canonical layer (NEW)
  utils/rpc_provider.js         <- compatibility shim (REPLACE existing)
  scripts/data_collection/masterFetcher/sushiswapFetcher.js  <- patched (REPLACE)

---

## NEXT MIGRATION TARGETS (Phase A completion)
  1. arbitrumFetcher.js      (highest priority — primary chain)
  2. curveFetcherArbitrum.js (primary venue)
  3. balancerFetcherArbitrum.js
  4. uniswapV3Fetcher.js
  Then base/optimism/unichain as lower priority.
