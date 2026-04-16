# ACTIVE TOOLING INDEX

<!-- STATUS: CURRENT | Last Reviewed: 2026-04-16 -->

Statuses: ACTIVE | ACTIVE_MIXED | DORMANT | LEGACY | UNVERIFIED

Purpose:
This file defines the current operator map for the repo.
Presence of code does not make it in-scope.
`docs/current/*` remains the authority for what is active vs frozen.

## ACTIVE — Core control layer (authoritative, do not bypass)

| Path | Category | Status | Purpose | Safe To Edit |
|---|---|---|---|---|
| scripts/master-fetcher.js | runner | ACTIVE | Canonical fetcher orchestrator | no — do not restructure without Boss ruling |
| utils/provider_factory.js | infra | ACTIVE | Canonical RPC entrypoint and provider routing layer | no — do not bypass |
| utils/rpc_provider.js | infra | ACTIVE | Compatibility shim for older consumers | cautious — preserve compatibility |
| scripts/data_collection/masterFetcher/arbitrumFetcher.js | fetcher | ACTIVE | Primary Arbitrum surface source | cautious — add pools only with token-order and schema discipline |
| scripts/analysis/breakeven_engine.js | analysis | ACTIVE | Canonical surface classification / breakeven math | no — Boss ruling required |
| scripts/tools/breakeven_report.js | reporting | ACTIVE | Canonical report runner for classified surfaces | cautious — add surfaces only |
| scripts/tools/rpc_benchmark.js | infra | ACTIVE | Benchmark endpoint latency, freshness, and reliability | yes |
| scripts/tools/surface_inventory_scanner.js | scanner | ACTIVE | Canonical surface inventory scan layer | cautious — treat as scanner authority |
| scripts/tools/surface_timeseries_monitor.js | scanner | ACTIVE | Surface monitoring / repeated scan capture | cautious |
| scripts/tools/surface_evaluator.js | analysis | ACTIVE | Surface quality evaluation layer | cautious |
| scripts/tools/discovery_ranker.js | analysis | ACTIVE | Rank discovered candidate surfaces | cautious |

## ACTIVE — Discovery helpers

| Path | Category | Purpose | Safe To Edit |
|---|---|---|---|
| scripts/discovery/find_arb_usdc_pools.js | discovery | ARB/USDC pool discovery | yes |
| scripts/discovery/arb_pool_smoke_test.js | discovery | Direct pool probe smoke test | yes |
| scripts/discovery/arb_pool_smoke_test_p2.js | discovery | Extended pool probe smoke test | yes |
| scripts/tools/arb_usdc_pool_discovery.js | discovery | ARB/USDC venue discovery helper | yes |
| scripts/tools/eth_usdc_pool_discovery.js | discovery | ETH/USDC venue discovery helper | yes |
| scripts/tools/wbtc_usdc_pool_discovery.js | discovery | WBTC/USDC venue discovery helper | yes |
| scripts/tools/multi_pair_pool_discovery.js | discovery | Multi-pair discovery helper | yes |
| scripts/tools/arb_next_venue_scanner.js | discovery | ARB venue expansion scanner | cautious |
| scripts/tools/arb_joe_v2_scanner.js | discovery | Trader Joe / venue-specific surface scan | cautious |
| scripts/tools/arb_watchlist_depth_check.js | discovery | Watchlist depth verification | yes |
| scripts/tools/build_token_registry_from_pools.js | discovery | Build token registry from discovered pools | cautious |

## ACTIVE — Validators

| Path | Category | Purpose | Safe To Edit |
|---|---|---|---|
| scripts/validators/arb_direct_validator.js | validator | ARB direct-vs-direct same-block validation | cautious |
| scripts/validators/arb_synthetic_validator.js | validator | ARB synthetic route validation | cautious |
| scripts/validators/arb_slippage_model.js | validator | ARB notional/slippage model | cautious |
| scripts/validators/spread_validator.js | validator | Same-block spread validation helper | cautious |
| scripts/validators/wbtc_spread_validator.js | validator | WBTC spread validation | cautious |
| scripts/tools/detector_surface_validator.js | validator | Detector / surface validation bridge | cautious |
| scripts/tools/filter_report.js | validator | Filtered output/report sanity helper | yes |
| scripts/tools/rpc_healthcheck.py | infra | RPC endpoint health check | yes |

## ACTIVE_MIXED — Fetcher fleet (inspect before editing)

These are real, in-use or near-use files, but not assumed to be uniformly hardened.

| Path | Notes |
|---|---|
| scripts/data_collection/masterFetcher/uniswapV3Fetcher.js | mixed-state; important baseline fetcher |
| scripts/data_collection/masterFetcher/sushiswapFetcher.js | mixed-state; inspect envelope/provider usage |
| scripts/data_collection/masterFetcher/curveFetcherArbitrum.js | partially modernized; verify anchoring/envelope |
| scripts/data_collection/masterFetcher/balancerFetcherArbitrum.js | verify pool coverage and provider pattern |
| scripts/data_collection/masterFetcher/gasPriceOracle.js | oracle-style fetcher; normalize telemetry expectations |
| scripts/data_collection/masterFetcher/baseFetcher.js | non-primary chain; not current focus |
| scripts/data_collection/masterFetcher/ethereumFetcher.js | non-primary chain; not current focus |
| scripts/data_collection/masterFetcher/optimismFetcher.js | non-primary chain; not current focus |
| scripts/data_collection/masterFetcher/unichainFetcher.js | non-primary chain; not current focus |
| scripts/data_collection/masterFetcher/curveFetcherEthereum.js | non-primary chain; inspect before use |
| scripts/data_collection/masterFetcher/testFetcher.js | utility/test role only; not authority |

## ACTIVE_MIXED — Analysis branch tools (historically real, not current authority)

These files may contain useful logic or reports, but they are not the current phase authority unless explicitly reactivated.

| Path | Notes |
|---|---|
| scripts/analysis/arb_window_activator.js | later-phase activator branch exists in repo; frozen unless reactivated |
| scripts/analysis/arb_tick_liquidity_map.js | useful for depth mapping; not current central authority |
| scripts/analysis/arb_depth_logger.js | replay-density / logging branch tool |
| scripts/analysis/arb_execution_simulator.js | execution realism branch tool |
| scripts/analysis/arb_session_analyzer.js | session compression / analysis helper |
| scripts/analysis/arb_volatility_monitor.js | supporting monitor; inspect before relying on it |
| scripts/analysis/volatility_divergence_engine.js | volatility layer component |
| scripts/tools/volatility_surface_scanner.js | volatility-oriented surface scanning |
| scripts/tools/volatility_divergence_report.js | report helper for divergence layer |
| scripts/tools/generate_price_replay.js | replay helper from later branch |
| scripts/tools/execution_realism_report.js | later branch report |
| scripts/tools/execution_sandbox_report.js | later branch report |
| scripts/tools/candidate_audit_report.js | later branch report |
| scripts/tools/near_miss_analysis_report.js | later branch report |
| scripts/tools/threshold_edge_report.js | later branch report |
| scripts/tools/threshold_edge_accumulator_report.js | later branch report |
| scripts/tools/execution_viable_session_analyzer.js | later branch report |
| scripts/tools/execution_viable_window_tracker.js | later branch report |
| scripts/tools/heat_correlation_check.js | supporting analysis tool |

## UNVERIFIED — Present, but not yet operator-approved

| Path | Why |
|---|---|
| scripts/data_collection/surfaces/arbSyntheticFetcher.js | surface-specific; verify status before use |
| scripts/data_collection/surfaces/arbUsdtFetcher.js | surface-specific; verify status before use |
| scripts/data_collection/surfaces/camelotV2Fetcher.js | surface-specific; verify status before use |
| scripts/tools/schema_inventory.py | infra helper; not part of core pipeline |
| scripts/tools/repo_files.py | repo utility only |
| scripts/tools/repo_reorg_ref_scanner.py | reorg utility only |
| scripts/tools/repo_reorg_surface_phase.py | reorg utility only |
| scripts/tools/extract_xlsx_formulas.py | unrelated utility |
| scripts/tools/fetch_dependabot_alerts.py | repo maintenance utility |
| utils/live_executor.py | execution-adjacent utility; frozen by scope |
| utils/metrics_engine.py | utility status not yet confirmed |
| utils/discord_notifier.js | notification utility; not current operator core |
| utils/discord_alerts.py | notification utility; not current operator core |

## DORMANT — Out of current phase scope, do not activate

| Area | Location |
|---|---|
| Execution engine | scripts/execution/ |
| Flash loan / contract execution layer | contracts/, scripts/flashloan*, phase execution files |
| Phase runners beyond current discovery scope | scripts/phase5/ through scripts/phase9/ |
| Shadow / A-B execution branches | scripts/shadow_ab/ |
| Regime engine branches | scripts/regime/ |
| PnL / sandbox / capital scaling branches not explicitly reactivated | later-phase analysis + reporting tools |
| Non-Arbitrum expansion as active mission | Base / Ethereum / Optimism / Unichain fetcher workflows |

## LEGACY — Historical or superseded by current operator map

| Area | Notes |
|---|---|
| Generic schema-mapping / universal-ingestion mentality as primary workflow | useful for exploration, not core authority |
| Any workflow that bypasses `provider_factory.js` | forbidden |
| Any workflow that treats execution-branch files as current authority without explicit reactivation | forbidden |

## Operator rules

1. `docs/current/*` beats historical handoffs.
2. File presence alone does not mean active scope.
3. Execution-related systems may exist in-repo but remain frozen unless explicitly reactivated.
4. Arbitrum remains the primary chain until `docs/current` changes.
5. Mixed-state fetchers must be inspected individually; do not broad-rewrite the fleet.
6. Core pipeline authority remains:

```text
FETCHERS → REDIS → SCANNER → TIMESERIES → ACTIVATION / CLASSIFICATION
