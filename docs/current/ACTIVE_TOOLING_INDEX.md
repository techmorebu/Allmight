# ACTIVE TOOLING INDEX

Status: CURRENT  
Phase: Execution Scaling

---

## CORE SYSTEM (LOCKED)

| Path | Category | Status | Purpose | Safe To Edit |
|------|----------|--------|---------|--------------|
| scripts/master-fetcher.js | runner | ACTIVE | fetch orchestration | ❌ |
| utils/provider_factory.js | infra | ACTIVE | RPC routing | ⚠️ |
| scripts/analysis/breakeven_engine.js | analysis | ACTIVE | profitability math | ❌ |
| scripts/tools/breakeven_report.js | reporting | ACTIVE | classification | ❌ |

---

## ACTIVATOR LAYER (PRIMARY FOCUS)

| Path | Status | Notes |
|------|--------|-------|
| scripts/analysis/arb_window_activator.js | ACTIVE | includes tick logger, ARMED/PASSIVE states |

---

## REPLAY + EXECUTION ANALYSIS (ACTIVE)

| Path | Status | Notes |
|------|--------|-------|
| scripts/tools/generate_price_replay.js | ACTIVE | replay generator (note: tick logger already live) |
| scripts/execution/execution_sandbox.js | ACTIVE | delay + size simulation |
| scripts/tools/execution_sandbox_report.js | ACTIVE | analysis output |

---

## INFRA OPTIMIZATION (CURRENT TARGET)

| Path | Status | Notes |
|------|--------|-------|
| scripts/tools/rpc_benchmark.js | ACTIVE | provider measurement tool |

---

## FETCHERS (SECONDARY PRIORITY)

Mixed state:
- arbitrumFetcher.js (stable)
- baseFetcher.js (stable)
- optimismFetcher.js (stable)

Legacy:
- uniswapV3Fetcher.js
- sushiswapFetcher.js
- curveFetcherArbitrum.js
- balancerFetcherArbitrum.js

Note:
Fetcher refinement is NOT the current bottleneck.

---

## DISCOVERY TOOLS (DEPRIORITIZED)

- find_arb_usdc_pools.js
- spread_validator.js
- surface scanner tools

These are not active priorities in this phase.

---

## RULE

Only edit tools that directly affect:
- latency
- timing
- execution realism
