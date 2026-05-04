# PROJECT ALLMIGHT — CURRENT STATE
**Date:** 2026-05-03
**Phase:** Execution Truth + Stability Validation (Single Surface)

```
Multi-surface expansion: LOCKED
Live execution:          LOCKED
Gate weight changes:     LOCKED (Boss ruling — collect data first)
```

---

## WHAT IS PROVEN ✅

**Execution path:**
- Direct Ramses V2 pool swap (no router) ✅
- ramsesV2SwapCallback working ✅
- 641/641 dry-run WOULD_EXECUTE (100% success) ✅
- ALL_FUNDED on every signal ✅
- Zero fork reset failures ✅

**Profitability (Boss confirmed):**
- ≥26bps → 100% net-positive, avg +$0.13  ✅ Elite
- ≥24bps → 95%+ net-positive, avg +$0.10  ✅ Preferred
- ≥22bps → 95% net-positive, avg +$0.063  ✅ Executable
- 21–22bps → 79% net-positive, marginal    ⚠️ Thin
- 20–21bps → 80% net-positive, avg +$0.008 ⚠️ Marginal
- <20bps   → 31% net-positive              ❌ Not viable

**Gas (confirmed from fork runner):**
- Units: 524k–700k per signal
- Cost: ~$0.069 at 0.05 gwei (live Arbitrum estimate)
- Historical fork gas: ~1 gwei (NOT used for live cost)

**Shadow model (v2):**
- Friction: 5bps calibrated (6,749 sandbox records)
- Realistic breakeven: 17.4bps
- Actual profitable floor: ~20bps (gas variability absorbs edge below)
- v2 direction accuracy: 81.3%
- Lifetime opportunity: $1,551 / Realistic: $310 / Calibrated: $124

**Gate score:**
- Verdict: DIRECTIONAL_ONLY (spread is primary predictor)
- NaN bug fixed (was scoring 17 on all sessions)
- Thresholds 75/85/92 unvalidated (no signals reached these bands yet)

---

## WHAT IS NOT READY ❌

- Live execution (LIVE_DEPLOY_APPROVED != true — hard lock)
- Gate threshold validation (no signals above 65 score yet)
- Multi-surface expansion (Ethereum watchlist only)
- Spread weight increase (INCREASE_TO_0.40 recommended, Boss says collect data first)
- WebSocket block subscription (deferred post-24h)

---

## INFRA STATUS (as of 2026-05-03)

**Deployed and confirmed working:**
- 8-process stack: fetcher → activator → volatility → heat → monitor → watchdog → notif → shadow
- Sticky primary RPC: `RPC_DESIGNATED_PRIMARY_URL=$TENDERLY_URL` in .env
- Supervisor: exit codes 10/11 → exponential cooldown 5/10/15min
- Stale threshold: 11min (was 7min)
- CONSEC reset: after 33min+ run (stale threshold × 3)
- Heat reporter: volatility_divergence_report.js --interval 30
- Watchdog: --loop 60 (runs continuously)
- Activator: --log flag routes JSON heartbeats to session dir
- Session zip: logs/archive/ (raw kept in logs/sessions/)
- Discord: market regime block in heartbeat
- Shadow v1+v2: live polling every 5min AND at stop

**Pending validation:**
- Confirm 60-min stale cycle broken by sticky primary fix
- 24h clean run (0 uncontrolled restarts)

**Known issues:**
- Infura handling 52% of calls (was — sticky primary fix should resolve)
- python3 redis not installed (spread_monitor.py skips gracefully)

---

## KEY FINDINGS (locked findings)

- **Same-block anchoring mandatory**: cross-block spreads 5–14× inflated
- **Spread is primary predictor**: dominates all other gate components
- **Arbitrage is episodic**: not continuous — bursts of 22bps+ windows
- **Active-tick depth** is the only valid liquidity metric (not TVL)
- **Venue inertia** (Ramses V2 slow repricing) is the structural edge source
- **Real breakeven ≈ 20bps** — 17.4bps theoretical understates gas variability

---

## CURRENT SESSION

**Session:** 20260503_1917 (or most recent — check `cat logs/allmight.session`)
**Target:** 24h clean run, 0 uncontrolled restarts
**Deploy blockers remaining:** (1) 24h clean run  (2) Boss explicit approval

---

## UNLOCK CONDITIONS (ALL must be met before Phase advance)

```
☐ 24h session with 0 uncontrolled restarts
☐ ≥3 FULLY_VALID Boss sessions (C9 marked)
☐ Dry-run ≥80% success rate sustained
☐ No unknown errors in activator or shadow logs
☐ Explicit Boss approval ruling
```

---

## FILE LOCATIONS (critical paths)

```
scripts/analysis/arb_window_activator.js    ← core signal detection
scripts/execution/shadow_execution_engine.js  ← v1 opportunity
scripts/execution/shadow_execution_engine_v2.js ← v2 realistic
scripts/execution/dry_execution_fork_runner.js  ← Hardhat callStatic
scripts/monitoring/notification_router.js    ← Discord heartbeat + regime
scripts/tools/surface_regime_report.js       ← hourly regime analytics
scripts/tools/start_all.sh                   ← 8-process launcher
scripts/tools/remote_ctl.sh                  ← operator control
utils/provider_factory.js                    ← RPC routing (sticky primary)
contracts/AllMightRamsesExecutor.sol         ← DO NOT MODIFY
```
