# NEXT ACTIONS

<!-- STATUS: CURRENT | Last Reviewed: 2026-04-16 -->

Purpose:
This file defines the ordered next actions for the currently authorized phase.
Authority is limited by `docs/current/*`.

## Current phase

Surface Discovery & Classification (Pre-Execution)

## Current mission

Expand, validate, classify, and rank real Arbitrum candidate surfaces without activating execution work.

## What is already done

- docs/current operator map exists
- discovery and validator folders exist
- reorg reports exist
- core fetch / analysis / report stack exists
- surface scanner layer exists
- validator layer exists
- execution-related branches remain frozen

## Immediate priorities

### 1. Lock current docs to repo reality
- [ ] Replace stale operator-map references in any remaining docs
- [ ] Confirm `REPO_STATUS_MATRIX.md` uses the same status language as `ACTIVE_TOOLING_INDEX.md`
- [ ] Add a short authority note wherever historical execution files could confuse operators

### 2. Audit mixed-state fetchers one-by-one
Do not broad-rewrite the fleet.

Order:
- [ ] `scripts/data_collection/masterFetcher/uniswapV3Fetcher.js`
- [ ] `scripts/data_collection/masterFetcher/sushiswapFetcher.js`
- [ ] `scripts/data_collection/masterFetcher/curveFetcherArbitrum.js`
- [ ] `scripts/data_collection/masterFetcher/balancerFetcherArbitrum.js`
- [ ] `scripts/data_collection/masterFetcher/gasPriceOracle.js`

Definition of done for a fetcher:
- provider access through `utils/provider_factory.js`
- explicit chain identity where required
- single-cycle block anchoring where applicable
- bounded concurrency or intentionally serial scheduling
- deterministic envelope
  - `status`
  - `partial`
  - `data`
  - `stats`
  - `failures`
- per-pool fault isolation
- no whole-fetcher collapse from one bad pool
- endpoint / telemetry behavior understood

### 3. Expand Arbitrum surface inventory
Priority pairs:
- [ ] ETH/USDC
- [ ] ETH/USDT
- [ ] WBTC/USDC
- [ ] DAI/USDC
- [ ] ARB/USDC follow-up expansion

Priority venues:
- [ ] Uniswap V3
- [ ] Camelot
- [ ] Ramses
- [ ] Sushi V3
- [ ] other Arbitrum venues only when directly justified

Expected outputs:
- [ ] updated pool inventory
- [ ] refreshed scan output
- [ ] refreshed ranked shortlist
- [ ] candidate-quality comparison notes

### 4. Resolve current best blocker
Current best researched surface:
- ARB/USDC UniV3 vs Camelot V3

Current blocker:
- thin UniV3 active-tick depth

Next actions:
- [ ] verify whether deeper ARB/USDC venues now exist
- [ ] test alternative venue pairings for ARB/USDC
- [ ] determine whether ARB/USDC remains worth primary focus or should be downgraded behind stronger ETH/WBTC surfaces

### 5. Tighten scanner / evaluator workflow
- [ ] confirm canonical roles of:
  - `surface_inventory_scanner.js`
  - `surface_timeseries_monitor.js`
  - `surface_evaluator.js`
  - `discovery_ranker.js`
- [ ] document exact command order for discovery → scan → evaluate → rank
- [ ] remove any remaining ambiguity around “scanner” vs “discovery helpers”

## Secondary priorities

### 6. Refresh validation pipeline notes
- [ ] ensure `docs/current/VALIDATION_PIPELINE.md` matches actual commands and filenames
- [ ] verify direct / synthetic / slippage validators are referenced correctly
- [ ] confirm same-block requirements remain explicit

### 7. Benchmark and stabilize infrastructure only when it supports discovery
- [ ] use `scripts/tools/rpc_benchmark.js` when provider behavior blocks scan quality
- [ ] keep provider changes scoped to discovery reliability
- [ ] do not reopen execution-latency optimization branch under current phase authority

## Explicitly out of scope

Do not activate or expand:
- execution systems
- flash-loan systems
- capital scaling
- sandbox / PnL branches as current authority
- cross-chain expansion as active mission
- size ladder / realism branch as current authority
- provider intent router as an execution-phase deliverable unless re-scoped for pure discovery support

## Working rule

When deciding what to do next, prefer work that improves:

1. surface coverage
2. surface correctness
3. surface classification quality
4. operator clarity

Avoid work that mainly improves dormant branches.

## Next recommended action after this file

Perform the first mixed-state fetcher audit:

- `scripts/data_collection/masterFetcher/uniswapV3Fetcher.js`

Output required from that audit:
- exact role
- current provider pattern
- current output shape
- current failure behavior
- gap list against hardened contract
- patch recommendation
