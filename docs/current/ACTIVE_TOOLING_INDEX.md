# AllMight — Active Tooling Index
**Date:** 2026-05-03  
**Phase:** Execution Truth + Stability Validation  
**Status:** Updated after full stack rebuild

---

## TIER 1 — LIVE SESSION PROCESSES (all 8 run every session)

| File | Purpose | Output | Status |
|------|---------|--------|--------|
| `scripts/master-fetcher.js` | Fetches price/depth data → Redis every 60s | `SESSION_DIR/fetcher.log` | ✅ ACTIVE |
| `scripts/analysis/arb_window_activator.js` | Core signal detection, heartbeat, gate scoring | `SESSION_DIR/activator.jsonl` | ✅ ACTIVE |
| `scripts/analysis/arb_volatility_monitor.js` | Volatility/divergence scoring | `SESSION_DIR/volatility.jsonl` | ✅ ACTIVE |
| `scripts/tools/volatility_divergence_report.js` | Heat reporter → heat.jsonl every 30s (watchdog dependency) | `SESSION_DIR/heat.jsonl` | ✅ ACTIVE |
| `scripts/spread_monitor.py` | Python spread monitor (optional — needs python3 redis) | `SESSION_DIR/monitor.log` | ⚠️ OPTIONAL |
| `scripts/tools/allmight_watchdog.sh` | Process health + stale detection, --loop 60 | `SESSION_DIR/watchdog.jsonl` | ✅ ACTIVE |
| `scripts/monitoring/notification_router.js` | Discord heartbeat (market regime + shadow) every 5min | `LOG_DIR/notification_router.log` | ✅ ACTIVE |
| `scripts/execution/shadow_execution_engine.js` | Shadow v1 (opportunity) every 5min | `LOG_DIR/shadow_engine.log` | ✅ ACTIVE |
| `scripts/execution/shadow_execution_engine_v2.js` | Shadow v2 (5bps friction, realistic) every 5min | `LOG_DIR/shadow_engine.log` | ✅ ACTIVE |

---

## TIER 2 — STOP PIPELINE (run automatically on every remote_ctl stop/restart)

| File | Purpose | Output | Status |
|------|---------|--------|--------|
| `scripts/execution/shadow_execution_engine.js` | Final v1 shadow pass | `SESSION_DIR/shadow_execution_totals.json` | ✅ ACTIVE |
| `scripts/execution/shadow_execution_engine_v2.js` | Final v2 shadow pass | `SESSION_DIR/shadow_execution_totals_v2.json` | ✅ ACTIVE |
| `scripts/execution/dry_execution_engine.js` | Quick callStatic dry run (non-fork) | `SESSION_DIR/shadow_dryrun_totals.json` | ✅ ACTIVE |
| `scripts/tools/shadow_accuracy_report.js` | Direction accuracy vs sandbox | `SESSION_DIR/shadow_accuracy_report.json` | ✅ ACTIVE |
| `scripts/tools/gate_score_backtest.js` | Gate score vs viability by bucket | `LOG_DIR/project_metrics/gate_score_backtest.json` | ✅ ACTIVE |
| `scripts/tools/spread_dominance_report.js` | Spread weight calibration report | `LOG_DIR/project_metrics/spread_dominance_report.json` | ✅ ACTIVE |
| `scripts/tools/project_metrics_tracker.js` | Lifetime metrics aggregation | `LOG_DIR/project_metrics.json` | ✅ ACTIVE |
| `scripts/monitoring/notification_router.js` | Discord stop summary | Discord #summary | ✅ ACTIVE |
| `(zip)` | All session files → logs/archive/ | `LOG_DIR/archive/session_XXXX.zip` | ✅ ACTIVE |
| `scripts/tools/log_retention_manager.js` | Archive cleanup, milestone preservation | `SESSION_DIR/analysis.log` | ✅ ACTIVE |

---

## TIER 3 — ON-DEMAND ANALYTICS (run manually when needed)

| File | Purpose | Command | Status |
|------|---------|---------|--------|
| `scripts/execution/dry_execution_fork_runner.js` | Full Hardhat fork runner, callStatic per signal block | `SESSION_ID=XXXX npx hardhat run ...` | ✅ READY |
| `scripts/tools/surface_regime_report.js` | Hourly UTC regime analytics across all sessions | `node ... --all` | ✅ NEW (2026-05-03) |
| `scripts/tools/project_metrics_tracker.js` | Show lifetime summary | `node ... --summary` | ✅ ACTIVE |
| `scripts/tools/gate_score_backtest.js` | Cross-session gate score analysis | `node ... --all` | ✅ ACTIVE |
| `scripts/tools/spread_dominance_report.js` | Spread band viability calibration | `node ... --all` | ✅ ACTIVE |
| `scripts/tools/dryrun_confidence_log.js` | Mark C9 Boss-valid sessions | `node ... --mark-c9 <session_dir>` | ✅ ACTIVE |
| `scripts/tools/rerun_shadow_sessions.sh` | Re-run shadow engines on all historical sessions | `bash ...` | ✅ ACTIVE |
| `scripts/execution/preflight_ramses_executor.js` | Live Arbitrum address verification | `node ...` | ✅ ACTIVE |

---

## TIER 4 — INFRASTRUCTURE (never modify without Boss ruling)

| File | Purpose | Status |
|------|---------|--------|
| `utils/provider_factory.js` | RPC routing — sticky primary, freshness tiers, round-robin | ✅ PATCHED (sticky primary 2026-05-03) |
| `utils/rpc_provider.js` | RPC compat shim | ✅ ACTIVE |
| `contracts/AllMightRamsesExecutor.sol` | On-chain executor — Ramses flash arb | 🔒 FROZEN (deployed and preflight-verified, do not modify) |
| `hardhat.config.js` | Hardhat fork config for dry execution | ✅ ACTIVE |
| `.env` | All secrets + RPC URLs + feature flags | ✅ ACTIVE |

---

## OPERATOR CONTROL

| File | Purpose | Status |
|------|---------|--------|
| `scripts/tools/start_all.sh` | 8-process launcher + stop pipeline + health check | ✅ ACTIVE (full rebuild 2026-05-03) |
| `scripts/tools/remote_ctl.sh` | Operator CLI: start/stop/restart/status/abort/metrics | ✅ ACTIVE |
| `scripts/tools/pre_run_eval.sh` | 48-point pre-launch checklist | ✅ ACTIVE |
| `restart_wrapper.sh` | Legacy auto-restart (superseded by supervisor in start_all.sh) | ⚠️ DORMANT |

---

## DOCS (current phase)

| File | Purpose | Status |
|------|---------|--------|
| `docs/current/PROJECT_STATE_CURRENT.md` | Proven vs not proven, unlock conditions | ✅ NEW (2026-05-03) |
| `docs/current/NEXT_ACTIONS.md` | Ordered CPT task queue | ✅ NEW (2026-05-03) |
| `docs/current/SYSTEM_GUARDRAILS.md` | Rules CPT cannot break | ✅ NEW (2026-05-03) |
| `docs/current/HANDOFF_BLOCK_CPT.txt` | Paste into new chat to prevent regression | ✅ NEW (2026-05-03) |
| `docs/current/ACTIVE_TOOLING_INDEX.md` | This file | ✅ UPDATED (2026-05-03) |
| `docs/current/LIVE_READINESS_GATE.md` | Deploy checklist + blockers | ✅ ACTIVE |
| `docs/current/STACK_STATE.md` | Process stack confirmed working state | ✅ ACTIVE |

---

## KEY LOG PATHS

```
logs/
  sessions/
    session_YYYYMMDD_HHMM/          ← raw session files (kept for analysis)
      activator.jsonl               ← signals + heartbeats + supervisor events
      shadow_execution_totals.json  ← v1 opportunity
      shadow_execution_totals_v2.json ← v2 realistic
      shadow_dryrun_totals.json     ← dry run (if run)
      heat.jsonl                    ← heat reporter output
      volatility.jsonl              ← volatility monitor output
      watchdog.jsonl                ← watchdog health records
      session_totals.json           ← cumulative session stats
  archive/
    session_YYYYMMDD_HHMM.zip       ← compressed (written at every stop)
  project_metrics/
    gate_score_backtest.json        ← cross-session gate analysis
    spread_dominance_report.json    ← spread band calibration
    surface_regime_report.json      ← hourly UTC regime analytics (new)
    lifetime_sessions.jsonl         ← per-session metrics ledger
  project_metrics.json              ← lifetime aggregated metrics
  allmight.pid                      ← running process PIDs
  allmight.session                  ← current session ID
  notification_router.log           ← Discord router log
  shadow_engine.log                 ← shadow v1+v2 polling log
  activator.jsonl                   ← ROOT (stale — heartbeats now in session dir)
```

---

## RECENTLY ADDED / CHANGED (2026-05-02/03)

| Change | File | Why |
|--------|------|-----|
| Sticky primary RPC | `utils/provider_factory.js` | Infura was at 52% causing 60min stale cycle |
| Supervisor exit codes 10/11 | `scripts/analysis/arb_window_activator.js` | Controlled exits get cooldown not fast restart |
| Exponential backoff | `scripts/tools/start_all.sh` | Prevents 15min cooldown lock after long healthy runs |
| Heat reporter (process 3b) | `scripts/tools/start_all.sh` | Watchdog requires heat.jsonl to be fresh |
| Watchdog --loop 60 | `scripts/tools/start_all.sh` | Was exiting after single check |
| Activator --log flag | `scripts/tools/start_all.sh` | JSON heartbeats were going to root not session dir |
| Market regime heartbeat | `scripts/monitoring/notification_router.js` | Operator visibility on surface activity |
| Double notification fix | `scripts/monitoring/notification_router.js` | --startup + runOnce() sent two messages |
| Zip to logs/archive/ | `scripts/tools/start_all.sh` | Separate compressed from raw session files |
| surface_regime_report.js | `scripts/tools/surface_regime_report.js` | Hourly UTC window analytics |
| Shadow v2 in live loop | `scripts/tools/start_all.sh` | Was only running v2 at stop |

---

## LOCKED / DO NOT TOUCH

| File | Reason |
|------|--------|
| `contracts/AllMightRamsesExecutor.sol` | Deployed on Arbitrum — any change requires redeploy + Boss ruling |
| `scripts/execution/capital_policy.js` | Mode 0 enforced — do not change capital modes |
| All `MIN_VIABLE_SPREAD_PCT` values | Boss ruling required to change floor |
| Gate weights (spread: 0.30) | Increase to 0.40 is candidate — not yet approved |
