# NEXT ACTIONS — ORDERED
**Project:** AllMight  
**Phase:** Execution Truth + Stability Validation  
**Last updated:** 2026-05-03

CPT reads NEXT_ACTIONS.md before doing anything. Work top-down. Do not jump ahead.

---

## ✅ COMPLETED (do not redo)

- [x] Shadow v1+v2 engines (formula fix, field mapping)
- [x] Dry execution fork runner (641/641 WOULD_EXECUTE)
- [x] Gate score NaN fix
- [x] Supervisor exponential backoff + exit codes 10/11
- [x] Stale threshold 7min → 11min
- [x] Sticky primary RPC (provider_factory.js)
- [x] 8-process stack (heat reporter, watchdog --loop 60)
- [x] Discord market regime heartbeat
- [x] surface_regime_report.js built
- [x] Session zip to logs/archive/
- [x] Stop pipeline unified (zip + shadow + metrics + Discord)
- [x] Notification router double-send fix

---

## PRIORITY 1 — STABILITY (blocking everything else)

### Task 1.1 — Confirm 24h clean run
```
Target session: currently running
Check at: 24h mark
Success criteria:
  - restartCount = 0 (no uncontrolled restarts)
  - activator.jsonl has continuous heartbeats (no 7min stale loop)
  - watchdog HEALTHY throughout
  - all 8 processes stayed alive
  - provider routing shows Tenderly dominant (check rpc_freshness.jsonl)

Command to check:
  remote_ctl status
  node scripts/tools/project_metrics_tracker.js --summary
```

### Task 1.2 — Mark C9 on valid sessions
```
Sessions pending C9:
  - 20260428_2329 (dry run proven, execution confirmed)
  - 20260428_0817 (if qualifying)

Command:
  node scripts/tools/dryrun_confidence_log.js --mark-c9 logs/sessions/session_20260428_2329
  node scripts/tools/dryrun_confidence_log.js --mark-c9 logs/sessions/session_20260428_0817
```

### Task 1.3 — Run surface_regime_report after 24h
```
Command:
  node scripts/tools/surface_regime_report.js --all

Report goes to: logs/project_metrics/surface_regime_report.txt
Send output to Boss for UTC window analysis
```

---

## PRIORITY 2 — ANALYTICS (after 24h confirmed)

### Task 2.1 — Re-run backtest + spread dominance
```
After 2-3 more sessions:
  node scripts/tools/gate_score_backtest.js --all
  node scripts/tools/spread_dominance_report.js --all

Report to Boss — do not adjust weights without ruling
```

### Task 2.2 — Re-run shadow engines on all sessions
```
If shadow metrics show $0 or stale:
  bash ~/Downloads/rerun_shadow_sessions.sh

Then:
  node scripts/tools/project_metrics_tracker.js --summary
```

---

## PRIORITY 3 — DRY EXECUTION (expand sample when PRIME signals appear)

### Task 3.1 — Run full dry execution on next high-spread session
```
Only run when session has ≥10 signals ≥22bps (check shadow_execution_totals.json)

Command:
  SESSION_ID=XXXXXXXX_XXXX GAS_PRICE_GWEI=0.05 \
    npx hardhat run scripts/execution/dry_execution_fork_runner.js \
      --network hardhat 2>&1 | tee logs/dry_run_full.txt

Success criteria:
  - executionSuccessRate ≥ 80%
  - fundingStatus = ALL_FUNDED
  - forkResetFailedCount = 0
```

---

## PRIORITY 4 — PHASE UNLOCK (Boss decision only)

```
When ALL of these are true:
  ☐ 24h clean run confirmed
  ☐ ≥3 C9 sessions marked
  ☐ Dry-run ≥80% on new signals
  ☐ No unknown errors
  ☐ Boss issues explicit deploy approval

Then and only then:
  Read LIVE_READINESS_GATE.md and follow deploy checklist
```

---

## DO NOT DO (without explicit Boss ruling)

```
❌ Deploy AllMightRamsesExecutor to mainnet
❌ Set LIVE_DEPLOY_APPROVED=true
❌ Add new trading surfaces
❌ Change gate weights (spread 0.30 → 0.40 is candidate, not approved)
❌ Implement WebSocket block subscription
❌ Modify execution contract
❌ Change MIN_VIABLE_SPREAD_PCT
❌ Enable any live capital flow
```
