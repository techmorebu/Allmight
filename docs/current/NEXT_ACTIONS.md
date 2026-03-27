# NEXT ACTIONS

<!-- STATUS: CURRENT | Last Reviewed: 2026-03-27 -->

Ordered queue. Do not reorder without Boss approval.

## 1 -- Repo Hygiene (IN PROGRESS)
- [x] Boss ruling received (2026-03-27)
- [x] Reorg script written: scripts/tools/repo_reorg_surface_phase.py
- [ ] Run --plan and verify output
- [ ] Run --apply and commit
- [ ] Run path-reference scanner: scripts/tools/repo_reorg_ref_scanner.py
- [ ] Fix any broken require() / import references
- [ ] Commit 1: repo: establish current-phase operator map and archive structure
- [ ] Commit 2: repo: group discovery and validator helpers

## 2 -- Surface Inventory Framework
- [ ] Deploy surface_inventory_scanner.js to scripts/tools/
- [ ] Run scan -- collect depth measurements for SushiSwap V3, Ramses V2, UniV3 alt tiers
- [ ] Report all classifications to Boss before proceeding

## 3 -- PRIORITY 1: Resolve ARB/USDC blocked_liquidity
- [ ] Identify venue with active-tick depth > $10k, fee <= 0.10%
- [ ] Run standard 8-step validation sequence (see VALIDATION_PIPELINE.md)
- [ ] Add to breakeven_report.js, run engine, report to Boss -- await ruling

## 4 -- PRIORITY 2: WBTC blocked_fee
- [ ] Research 1-hop WBTC/USDC <= 0.05% (SushiSwap V3, UniV3)
- [ ] Or test WBTC/WETH at different time window (burst-trading pattern)

## DO NOT START
- Execution logic
- Contract work
- Chain expansion
- Rewriting working fetchers, breakeven engine, or provider factory
