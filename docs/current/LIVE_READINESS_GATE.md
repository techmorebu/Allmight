# LIVE READINESS GATE + CONTROLLED DRY-RUN PROTOCOL

Status: CURRENT  
Authority: Boss ruling 2026-04-22  
Phase: Live Readiness Gate + Controlled Dry-Run Protocol

---

## CURRENT SYSTEM CLASSIFICATION

```
State:           DETECTION + SIMULATION ONLY
On-chain calls:  pool reads and getFeeData — NO transactions
Contract:        ArbitrageBot (0xD70d9f…) deployed but NOT called by active stack
Execution path:  execute_trade.js + --live flag + METAMASK_PRIVATE_KEY
                 → NONE of these are wired into the active pipeline
```

The active stack (`start_all.sh` → 5 processes) produces:

- `EXECUTION_READY` signals (detection output)
- `blueprints.jsonl` (sizing and economic models)
- `execution_candidate_audit.jsonl` (classification)
- `sandbox_results.json` (simulated PnL at 0/500/1000ms)

**No funds move. No transactions are submitted.** This is the correct current state.

---

## WHAT "CONTROLLED DRY-RUN" MEANS

A **controlled dry-run** is a full session run where:

- The complete 5-process stack operates normally
- Real market data is fetched from Arbitrum mainnet via Infura
- Real spread detection, signal generation, and blueprint creation occur
- The full post-run analysis pipeline runs automatically
- **No on-chain transactions are submitted**
- **No funds are at risk**

This is **not** a paper trade or backtested simulation. It uses live data. The only difference from live execution is that the execution bridge (`execute_trade.js`) is not triggered.

A dry-run session is valid for Boss review and counts toward pattern confidence.

---

## LIVE READINESS CRITERIA

All conditions must be TRUE before any consideration of activating live execution.

### Category 1 — Infrastructure

| Condition | Requirement | Check |
|-----------|-------------|-------|
| Primary endpoint | Infura at 0 block lag | `rpc_benchmark.js --chain arbitrum --samples 20` |
| Second endpoint | ≥1 additional endpoint at lag ≤ 1 block | Benchmark confirms |
| Provider mode | INFURA_ONLY no longer required | Second clean endpoint available |
| Consecutive clean sessions | ≥3 sessions with ACCEPTABLE or better infra | `session_policy_check.js` history |

**Current blocker:** second clean endpoint not yet available. Infura-only operation accepted for dry-run phase but is NOT acceptable for live execution without backup.

---

### Category 2 — Session Health

| Condition | Requirement | Check |
|-----------|-------------|-------|
| Policy mode | STANDARD (not CONSERVATIVE) | `session_policy_check.js` returns STANDARD |
| Watchdog ran | `watchdog.jsonl` present with ≥5 records | Session artifact checklist |
| Heartbeat active | Discord heartbeats arriving every 5 min | Discord log |
| No PAUSE events | Zero PAUSE triggers in last session | analysis.log + Discord |
| Session duration | ≥4 hours (surface needs time to show its pattern) | session duration metric |

---

### Category 3 — Performance Consistency

| Condition | Requirement | Check |
|-----------|-------------|-------|
| Confirmed candidates | ≥3 sessions with > 0 confirmed | Cross-session accumulator |
| Band A viable rate | ≥80% consistent across ≥3 sessions (size ladder) | `size_ladder_accumulator.json` verdict = CONSISTENT or better |
| Sandbox viable | ≥30% at 0ms delay across ≥2 clean sessions | `sandbox_accumulator.json` |
| Capture ceiling | Adaptive model shows ≥85% viable ceiling | `adaptive_size_report.js` |

---

### Category 4 — Capital Readiness

| Condition | Requirement | Check |
|-----------|-------------|-------|
| Working capital | $525 available (STANDARD mode) | Operator confirms |
| Mode | STANDARD approved (not CONSERVATIVE) | Policy checker |
| No upper-band auto | $750+ blocked by guardrail | `capital_allocation_report.js` confirms |
| Sequential execution discipline | One trade at a time — no queue | Architecture confirmed |

---

### Category 5 — Notification Layer

| Condition | Requirement | Check |
|-----------|-------------|-------|
| Discord startup alert | Fires on session start | Discord ops channel |
| Discord heartbeat | Fires every 5 min in loop | Discord summary channel |
| Activator silence alert | Fires within 10 min of silence | Tested: restart activator, confirm alert |
| Stop summary | Fires on stop | Discord summary channel |

All four alert types must have been observed firing correctly in at least one session before live execution is considered.

---

## CONTROLLED DRY-RUN PROTOCOL

### What a valid controlled dry-run session requires

1. **Full stack launched** via `start_all.sh` (all 5 processes)
2. **Policy checker** returns STANDARD at session start
3. **Session runs ≥ 4 hours** continuously
4. **Watchdog ran the full session** (watchdog.jsonl has records throughout)
5. **Discord heartbeats arrived** every 5 min (check Discord after session)
6. **All required artifacts present** at stop (see Session Pack artifact checklist)
7. **Post-run analysis pipeline completed** without failures (no `✗` in analysis.log)

### What is observed during a dry-run

| Metric | Where to look | Target |
|--------|--------------|--------|
| Confirmed candidates | `execution_candidate_audit.jsonl` | > 0 |
| Capture rate (adaptive) | `adaptive_size_report.js` output | > 80% |
| Sandbox viable rate (0ms) | `sandbox_results.json` | > 30% |
| Infra grade | `session_policy_check.js --session` | CLEAN or ACCEPTABLE |
| Discord functioning | Discord log | All 4 alert types fired |
| Session value estimate | `capital_allocation_report.js` output | > $0 (any value) |

### What is NOT observed during a dry-run

- On-chain transaction submission
- Real PnL from executed trades
- Flash loan execution
- Contract interaction beyond read calls

### What invalidates a dry-run

| Invalidating condition | Reason |
|-----------------------|--------|
| Watchdog not running | Cannot confirm infrastructure health |
| Policy = CONSERVATIVE or PAUSE at start | Session health insufficient |
| Analysis pipeline failures (`✗` in log) | Artifacts unreliable |
| Activator silent > 30 min mid-session | Signal continuity broken |
| No confirmed candidates in ≥ 4 hour session | Surface may be inactive |
| Discord alerts never fired | Notification layer broken — blind spot |
| Session < 4 hours | Insufficient surface exposure |

---

## NO-GO MATRIX

A no-go condition **immediately blocks** any escalation, mode change, or live execution consideration.

| Condition | Type | Blocks |
|-----------|------|--------|
| Activator silent > 10 min | HARD | All operation |
| Infra COMPROMISED | HARD | All operation |
| Policy checker returns PAUSE | HARD | All operation |
| Watchdog not running | HARD | Boss review, live execution |
| Discord heartbeat not firing | HARD | Live execution consideration |
| Second endpoint not available | HARD | Live execution (dry-run OK) |
| `METAMASK_PRIVATE_KEY` not set | HARD | Live execution (not a blocker for dry-run) |
| `ARBITRAGE_BOT_ADDRESS` not set | HARD | Live execution (not a blocker for dry-run) |
| Infra DEGRADED | SOFT | Mode escalation, aggressive mode |
| Session age < 15 min | SOFT | STANDARD mode |
| Band A ladder not CONSISTENT | SOFT | Live execution confidence |
| < 3 dry-run sessions completed | SOFT | Live execution consideration |

---

## MINIMUM STANDARD FOR A BOSS-VALID CONTROLLED RUN

A session submitted to Boss for review must meet ALL of the following:

```
✅ All 5 processes ran the full session
✅ Watchdog ran (watchdog.jsonl present with records)
✅ Policy was STANDARD at session start
✅ Session duration ≥ 4 hours
✅ At least 1 confirmed candidate produced
✅ sandbox_results.json exists and viable% > 0
✅ analysis.log has no ✗ failures
✅ Discord startup + heartbeat + stop summary all fired
✅ Boss summary template completed (from SESSION_PACK.md)
```

If any box is unchecked: the session is **not Boss-valid**. Note the failure and run again.

---

## PATH TO LIVE EXECUTION (NOT ACTIVE — FUTURE REFERENCE)

When all live readiness criteria are met, live execution activation requires:

1. **Boss explicit ruling** — "approved for live execution"
2. **METAMASK_PRIVATE_KEY** set in `.env`
3. **ARBITRAGE_BOT_ADDRESS** confirmed (0xD70d9f2245a23E3a4d07B2662029AD36f8dDa5a9 on Arbitrum)
4. **Second clean endpoint** confirmed at lag ≤ 1 block
5. **First live session**: CONSERVATIVE mode only ($300 max), 1-hour observation window
6. **No auto-escalation** to STANDARD until first live session produces clean output

This path is documented here for reference only. It is **not active**.  
Do not configure `METAMASK_PRIVATE_KEY` until Boss issues explicit live execution approval.

---

## READINESS CHECKLIST (CURRENT STATE)

```
LIVE READINESS STATUS — as of 2026-04-22

Infrastructure:
  ✅ Infura primary: lag 0, score 86.8 — CONFIRMED
  ❌ Second endpoint: none available at lag ≤ 1 block — BLOCKER for live
  ✅ Infura-only acceptable for dry-run phase

Session Health:
  ✅ Policy checker operational (session_policy_check.js)
  ✅ Watchdog integrated (Process 5 in start_all.sh)
  ✅ Heartbeat notifications operational (Discord v2)
  ✅ Mode change alerts operational

Performance:
  ✅ Band A viable rate: CONSISTENT_STRONG (5 sessions × $200–$1000)
  ✅ Timing model: ROBUST (SURVIVES_SUB_SECOND_DELAY confirmed)
  ✅ Adaptive model: 95% capture ceiling at $500
  ✅ Capital policy: STANDARD mode approved ($525 working capital)

Capital:
  ⬜ METAMASK_PRIVATE_KEY: not configured (correct — dry-run phase)
  ⬜ ARBITRAGE_BOT_ADDRESS: not in active .env (correct — dry-run phase)
  ✅ Working capital target: $525 (STANDARD mode)

Overall:
  ✅ CONTROLLED DRY-RUN: READY
  ❌ LIVE EXECUTION: NOT READY (second endpoint + Boss explicit approval required)
```

---

## VERSION

```
v1.0 — 2026-04-22
Authority: Boss ruling 2026-04-22
```
