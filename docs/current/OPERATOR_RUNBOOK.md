# OPERATOR RUNBOOK + LAUNCH DISCIPLINE

Status: CURRENT  
Authority: Boss ruling 2026-04-22 — Deployment Policy APPROVED  
            Boss ruling 2026-05-07 — Operational baseline freeze (Phase 3 sections added)  
Phase: Operator Runbook + Launch Discipline + Phase 3 Operations

---

## CONSTITUTIONAL DOC FAMILY (reference these before this runbook for any conflict)

```
CANONICAL_SURFACE.md      — what surface we trade
SYSTEM_STATE.md           — what's actually deployed
ARCHITECTURE_LOCK.md      — what AllMight IS and IS NOT
CHANGE_CONTROL.md         — T0–T5 change classification
INCIDENT_LOG.md           — institutional memory
```

If anything below contradicts a constitutional doc, the constitutional doc wins.

---

## MINIMUM REQUIRED PROCESSES FOR A VALID SESSION

A Phase 3 session only counts when all canonical runtime processes are running. Legacy pre-Phase-3 references to five processes are superseded by `SYSTEM_STATE.md`.

**Authority: `SYSTEM_STATE.md` "Active processes (canonical 8)" section.** That document is the single source of truth for which processes constitute a valid stack and what each one outputs. Cross-reference it during launch and during the post-launch health verification.

Validity rules:

- If any **canonical fetcher / activator / volatility / heat / monitor** process is missing → session is invalid; stop and restart.
- If the **watchdog** is missing → session may run but no Discord health alerts fire. Launch the watchdog immediately.
- If the **notification_router** is missing → session may run but no heartbeats reach Discord. Launch immediately.
- If the **shadow_engine** is missing → session may run but shadow PnL telemetry is absent (no execution effect; lower urgency to restart).

For runtime verification:
```bash
# Boss-canonical 8 processes per SYSTEM_STATE.md
cat logs/allmight.pid
ps aux | grep -E "fetcher|activator|volatility|heat|spread_monitor|watchdog|notification_router|shadow" | grep -v grep
bash scripts/tools/system_integrity_audit.sh   # Section 1 (Process Census)
```

---

## LAUNCH SEQUENCE (MANDATORY — FOLLOW EXACTLY)

### Step 1 — Verify Redis

```bash
redis-cli ping
```

Expected output: `PONG`

If not PONG: start Redis first.
```bash
redis-server --daemonize yes
# or
sudo systemctl start redis
```

Do not proceed without Redis.

---

### Step 2 — Pull latest code

```bash
cd ~/Allmight && git pull
```

Always pull before launch. Never run on stale code.

---

### Step 3 — Launch full stack

```bash
nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 &
disown
```

This single command starts all 5 processes in order with health checks:
- Fetcher starts → waits for first output (max 60s)
- Volatility monitor starts → waits for ≥2 records (max 90s)
- Heat runner starts → waits for ≥3 records (max 120s)
- Activator starts → supervised loop (auto-restarts on non-zero exit)
- Watchdog starts → loops every 300s

Total warmup time: approximately **4–5 minutes**.

---

### Step 4 — Verify after 5 minutes

```bash
bash scripts/tools/start_all.sh status
```

Expected output: all 5 processes show `RUNNING`.

If any show `NOT RUNNING`: investigate `logs/launch.log` before proceeding.

---

### Step 5 — Check session policy

```bash
node scripts/tools/session_policy_check.js
```

Read the output carefully:

| Output | Action |
|--------|--------|
| `STANDARD` | Proceed — default live posture |
| `CONSERVATIVE` | Proceed with caution — reduced size |
| `AGGRESSIVE eligible` | Do not auto-escalate — operator decision |
| `PAUSE` | Stop immediately — fix underlying issue first |

If policy returns PAUSE on a fresh launch: something is wrong. Check `logs/launch.log` and the specific PAUSE reason before retrying.

---

## PRE-SESSION CHECKLIST

Before every session counts as active:

- [ ] `redis-cli ping` returns PONG
- [ ] `git pull` completed without errors
- [ ] `start_all.sh status` shows all 5 processes RUNNING
- [ ] `session_policy_check.js` returns STANDARD or CONSERVATIVE (not PAUSE)
- [ ] `logs/session_YYYYMMDD_HHMM/heat.jsonl` has ≥ 3 lines
- [ ] `logs/session_YYYYMMDD_HHMM/activator.jsonl` is being written (growing)
- [ ] Discord received the startup notification

If any box is unchecked: do not count the session for analysis purposes.

---

## IN-SESSION RULES

### Continue operating when:

- All 5 processes are running
- Policy checker returns STANDARD or CONSERVATIVE
- Activator wrote to `activator.jsonl` within the last 10 minutes
- No Discord FAILED alert has fired

### Downgrade to CONSERVATIVE when:

- Policy checker returns CONSERVATIVE
- Infrastructure grade drops to DEGRADED (watchdog will Discord-alert)
- Session is under 15 minutes old

### Pause trading when:

- Policy checker returns PAUSE
- Discord fires `💀 ACTIVATOR SILENT` alert
- Discord fires `🚨 SYSTEM FAILED` alert
- Watchdog shows FAILED status in `watchdog.jsonl`

### Terminate session when:

- Activator silent for > 30 minutes despite restart attempts
- Infrastructure COMPROMISED and not recovering after 2 watchdog cycles
- Confirmed candidate rate = 0 for > 3 consecutive hours (surface inactive)

---

## RESTART PROCEDURES

### Activator only (same session, same logs)

Use when: activator stopped but other processes are healthy.

```bash
bash scripts/tools/start_all.sh restart-activator
```

This restarts the activator within the same session folder. Does not reset session ID.

### Full stack restart

Use when: multiple processes stopped or session is stale.

```bash
bash scripts/tools/start_all.sh stop
# wait 30 seconds
bash scripts/tools/start_all.sh status  # confirm all stopped
nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 &
disown
# wait 5 minutes
bash scripts/tools/start_all.sh status
node scripts/tools/session_policy_check.js
```

---

## POST-SESSION WRAP (MANDATORY)

### Step 1 — Stop and run analysis

```bash
bash scripts/tools/start_all.sh stop
```

This automatically:
1. Stops all 5 processes
2. Runs the full post-run analysis pipeline (9 steps)
3. Compresses session into `logs/session_YYYYMMDD_HHMM.zip`

Analysis pipeline output files:
```
execution_candidate_audit.jsonl  — candidate classification
near_miss_analysis.json          — near-miss breakdown
threshold_edge.json              — edge tracker
tier_breakdown.json              — CONFIRMED/ADAPTIVE/BELOW stats
size_ladder.json                 — size ladder by tier
flash_loan_readiness.json        — flash overhead analysis
sandbox_results.json             — execution sandbox (0/500/1000ms)
threshold_edge_accumulator.json  — cross-session edge trends
size_ladder_accumulator.json     — cross-session size consistency
sandbox_accumulator.json         — cross-session delay survivability
```

### Step 2 — Verify artifacts

```bash
bash scripts/tools/start_all.sh upload
```

Confirms which files were generated and shows the zip path.

### Step 3 — Session sanity checks

Before uploading to CPT, verify:

- [ ] `sandbox_results.json` exists and viable% > 0
- [ ] `execution_candidate_audit.jsonl` exists and has records
- [ ] Analysis log shows no pipeline failures: `grep "✗" logs/session_*/analysis.log`
- [ ] `watchdog.jsonl` exists (confirms watchdog ran)

### Step 4 — Run policy report (optional, recommended)

```bash
node scripts/tools/capital_allocation_report.js \
  --blueprints logs/session_YYYYMMDD_HHMM/blueprints.jsonl \
  --replay     logs/session_YYYYMMDD_HHMM/price_replay.jsonl \
  --mode standard
```

### Step 5 — Run adaptive size report (optional, recommended)

```bash
node scripts/tools/adaptive_size_report.js \
  --blueprints logs/session_YYYYMMDD_HHMM/blueprints.jsonl \
  --replay     logs/session_YYYYMMDD_HHMM/price_replay.jsonl
```

---

## WATCHDOG DISCIPLINE

The watchdog is Process 5 and launches automatically with `start_all.sh`.

**It must be running for session trust.**

What the watchdog does:
- Checks all process PIDs every 300 seconds (5 minutes)
- Checks file staleness (fetcher, activator, heat, volatility)
- Sends Discord alert on DEGRADED or FAILED status
- Sends Discord alert on dead PIDs

What the new heartbeat check does (in `notification_router.js`):
- Fires independently of watchdog
- Alerts if `activator.jsonl` has not been written for > 10 minutes
- Works even if watchdog is not running (safety net only — not a replacement)

**The watchdog is mandatory. The heartbeat is a backup.**

---

## NOTIFICATION EXPECTATIONS

| Event | Discord message | Action required |
|-------|----------------|-----------------|
| Session start | `🟢 ALLMIGHT STARTED` | None — confirm receipt |
| First candidate | `📊 CANDIDATE CONFIRMED` | None — surface active |
| Activator silent | `💀 ACTIVATOR SILENT` | Check process, restart if needed |
| System DEGRADED | `⚠️ SYSTEM DEGRADED` | Check infra, consider downgrade |
| System FAILED | `🚨 SYSTEM FAILED` | Pause immediately, investigate |
| System RECOVERED | `✅ SYSTEM RECOVERED` | Resume normal operation |
| Session stop | `📋 SESSION SUMMARY` | Review confirmed count |

If startup notification was NOT received: Discord or notifier is broken. Fix before trusting alerts.

---

## QUICK REFERENCE — DAILY OPERATIONS

### Morning launch

```bash
redis-cli ping                                              # verify Redis
cd ~/Allmight && git pull                                   # pull latest
nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 &
disown
# wait 5 min
bash scripts/tools/start_all.sh status                     # verify processes
node scripts/tools/session_policy_check.js                 # check mode
```

### Mid-session check

```bash
bash scripts/tools/start_all.sh status                     # process health
node scripts/tools/session_policy_check.js                 # mode check
```

### Evening stop

```bash
bash scripts/tools/start_all.sh stop                       # stop + auto-analysis
bash scripts/tools/start_all.sh upload                     # verify artifacts
```

### Activator stopped unexpectedly

```bash
bash scripts/tools/start_all.sh restart-activator          # same session restart
node scripts/tools/session_policy_check.js                 # re-check mode
```

---

## SESSION VALIDITY CRITERIA

A session is valid for analysis and Boss review when:

1. All 5 processes ran for the majority of the session
2. `watchdog.jsonl` contains records (watchdog was running)
3. `activator.jsonl` contains heartbeat records (activator was writing)
4. `execution_candidate_audit.jsonl` was generated (analysis pipeline ran)
5. Policy was STANDARD or CONSERVATIVE at session start

A session is invalid (do not submit to Boss) when:

- Watchdog was not running (no `watchdog.jsonl`)
- Session was under 30 minutes
- Policy was PAUSE at start
- Analysis pipeline failed (check `analysis.log`)

---

## PHASE 3 OPERATIONS — DEPLOYED + DRY-LOCKED

The pre-deploy daily ops above remain valid. The following sections govern operations now that the executor is deployed and rehearsals are running.

### Audit cadence

```
audit_rehearsal_wiring.sh         BEFORE every rehearsal launch (mandatory)
                                    Run time: ~30s
                                    Exit 1 = DO NOT launch rehearsal

system_integrity_audit.sh         AFTER every stack restart (mandatory)
                                    AFTER any T3+ change (mandatory)
                                    Daily during long-running sessions (recommended)
                                    Run time: ~2-3 min
                                    Exit 1 = investigate before live ops
```

Both scripts are read-only. Running them never affects the stack.

### Rehearsal flow (dry mode — current Boss-approved posture)

```
PRECONDITIONS
  ✅  audit_rehearsal_wiring.sh exits 0
  ✅  Stack healthy (8 processes per logs/allmight.pid)
  ✅  Activator emitting fresh records (mtime < 120s)
  ✅  .env on disk: LIVE_DEPLOY_APPROVED=false / AUTO_MICRO_ONESHOT=false
  ✅  CANONICAL_SURFACE.md matches activator pair

LAUNCH (current Boss-approved 20bps dry)
  cd ~/Allmight
  LIVE_DEPLOY_APPROVED=true AUTO_MICRO_ONESHOT=true REHEARSAL_MIN_SPREAD_BPS=20 \
    nohup node scripts/execution/micro_live_oneshot.js \
    --dry --lock-after-trade \
    --max-wait-sec 14400 \
    > logs/dry_rehearsal_20bps_$(date +%Y%m%d_%H%M%S).log 2>&1 &
  echo $! > logs/dry_rehearsal_overnight.pid

VERIFY (within 10 seconds)
  - PID alive
  - sessionId matches the live session
  - .env on disk still false / false (inline overrides die with PID)

EXPECTED OUTCOMES
  🧪 Discord candidate channel    DRY rehearsal pass — gates passed
                                    DRY_MODE_LOCK_PLAN emitted
                                    [4] runtime proof complete
  ℹ️ Discord ops channel          TIMEOUT_NO_SIGNAL after max-wait
                                    No qualifier in window; relaunch later
  🔴 Discord candidate            SUBMIT_FAILED (rare in dry mode)

POST-OUTCOME
  - Read micro_live_trade.json for the structured outcome
  - .env on disk should be unchanged regardless of outcome
```

### Live flow (NOT YET AUTHORIZED — for future reference)

```
PRECONDITIONS for first live trade (Boss G3 ruling required)
  ✅  5/5 rehearsal evidence complete
       1. live address wiring     (proven by preflight)
       2. env loading              (proven by preflight)
       3. callStatic path          (proven by standalone probe)
       4. lock-after-trade         (proven by DRY_MODE_LOCK_PLAN runtime)
       5. Discord reporting        (proven by audit pings)
  ✅  Boss-issued G3 trade authorization, dated, on record
  ✅  audit_rehearsal_wiring.sh + system_integrity_audit.sh both green
  ✅  Wallet ETH ≥ 0.001 (gas reserve)
  ✅  Gas ≤ 0.05 gwei
  ✅  All Phase 3 doc updates committed (CANONICAL, SYSTEM_STATE, etc.)

LAUNCH (template — DO NOT RUN UNTIL G3 IS GIVEN)
  # 1. Boss-required floor for FIRST trade is 26bps, NOT 20bps
  cd ~/Allmight
  LIVE_DEPLOY_APPROVED=true AUTO_MICRO_ONESHOT=true \
    nohup node scripts/execution/micro_live_oneshot.js \
    --lock-after-trade --min-spread-bps 26 \
    --max-wait-sec 14400 \
    > logs/live_oneshot_$(date +%Y%m%d_%H%M%S).log 2>&1 &

  # 2. Operator OBSERVES the run actively. Do NOT walk away.

  # 3. On success/revert, the script auto-flips both flags to false.
  #    Verify .env shows false / false post-execution.

POST-EXECUTION
  - Run forensic review per Phase H1 hardening when available
  - Document trade in INCIDENT_LOG.md if any anomaly observed
  - Wait 24h before considering a second trade (Boss-locked daily cap = 1)
```

### Emergency disarm (always permitted, no ruling required)

```
SITUATION                          IMMEDIATE ACTION

Live trade about to fire wrong     pkill -f micro_live_oneshot.js
                                    sed -i 's/^LIVE_DEPLOY_APPROVED=.*/LIVE_DEPLOY_APPROVED=false/' .env
                                    sed -i 's/^AUTO_MICRO_ONESHOT=.*/AUTO_MICRO_ONESHOT=false/' .env

Activator producing bad signals    bash scripts/tools/start_all.sh stop

Suspected key compromise           1. pkill -f micro_live_oneshot.js
                                    2. Disarm flags (above)
                                    3. Move funds: send remaining ETH from
                                       deployer wallet to a NEW wallet
                                       on a clean key. Never reuse the
                                       compromised key.
                                    4. Document in INCIDENT_LOG.md

Anything that "feels wrong"        bash scripts/tools/start_all.sh stop
                                    Investigate before resuming.
```

The system is built to fail closed. Disarming never causes capital loss; only inaction in the face of a real emergency does.

### Discord alert interpretation

```
🚀  AllMight Started               Stack just launched. Heartbeat in ~5 min.

🟢  AllMight Heartbeat              Periodic health snapshot.
                                     Watchdog: HEALTHY  → all good
                                     Watchdog: DEGRADED → review staleComponents
                                     Watchdog: UNHEALTHY → likely needs restart

🧪  micro-live DRY rehearsal       Dry rehearsal hit gates. [4] proven.
                                     Read DRY_MODE_LOCK_PLAN in log.

ℹ️  micro-live TIMEOUT             Rehearsal completed without firing.
                                     Market regime didn't deliver a qualifier.
                                     No action needed; relaunch when ready.

🟡  micro-live RECEIPT PENDING     LIVE trade broadcast but no receipt within
                                     timeout. MANUAL REVIEW REQUIRED.
                                     Check Arbiscan with txHash from message.

🔴  micro-live SUBMIT FAILED       LIVE trade couldn't broadcast. Flags reset.
                                     System auto-locked. Investigate before
                                     re-arming.

✅  micro-live SUCCESS             LIVE trade succeeded.
                                     Flags auto-flipped to false (lock-after-trade).
                                     Begin forensic review.

🔴  micro-live ON-CHAIN REVERT     LIVE trade broadcast but reverted on-chain.
                                     Flags auto-flipped to false.
                                     Forensic review mandatory before retry.

🔬  AUDIT routing test ping        Generated by audit_rehearsal_wiring.sh
                                     or system_integrity_audit.sh. Disregard.
```

Channel routing:
- `#ops` channel — system events (start, stop, heartbeat, timeout, audit pings)
- `#candidate` channel — trade events (DRY pass, submit, revert, success, receipt-pending)

If a trade event arrives in `#ops` or a system event arrives in `#candidate`, the routing is broken — escalate.

### Regime interpretation

```
PROFILE (activator-emitted, advisory)
  SAFE         conservative gates, used for first live trades
  BALANCED     mid-tier, deferred until BALANCED rehearsal Boss-approved
  AGGRESSIVE   widest gates, deferred indefinitely

REGIME (heartbeat-emitted)
  surge        market actively dislocating; high signal density
  active       normal cross-venue activity
  quiet        low spread density; rehearsal may TIMEOUT
  fading       volatility collapsing; gate may block trades

VOLATILITY (regime input)
  RISING       widening spreads expected
  FLAT         no directional vol pressure
  FADING       volatility collapsing — RISK FOR FAILED TRADES
                even at qualifying spreads. Boss-locked gate
                blocks execution during FADING.

HEAT (advisory only — never gates execution per Boss 2026-04-09)
  EXTREME / HOT / WARM / COOL / UNKNOWN
```

### Do-nothing conditions (when NOT to trade or rehearse)

```
DO NOTHING when ANY of these are true:

❌  Watchdog status = UNHEALTHY
❌  Activator pair ≠ canonical surface (CANONICAL_SURFACE.md violation)
❌  audit_rehearsal_wiring.sh exits 1
❌  system_integrity_audit.sh fails > 0
❌  Volatility = FADING
❌  Gas > 0.05 gwei
❌  Wallet ETH < 0.001 (gas reserve insufficient)
❌  .env disarmed flags don't match expected state
❌  Any pending Boss ruling not yet given for the action
❌  You haven't slept in 24+ hours (operator fatigue is incident risk)
❌  You "feel rushed" — pace pressure is itself a red flag

DO NOTHING is always a valid output. The system rewards patience.
```

### Escalation paths

```
WHO DECIDES WHAT

CPT (assistant)            implementation, validation, reporting
                           classification of changes (T0-T5)
                           proposing Boss ruling requests with data
                           NOT classification thresholds, NOT execution
                           gates, NOT architecture decisions

Boss                       all classifications and thresholds
                           live trade authorization (G3)
                           architecture-level rulings
                           change-tier reclassification
                           operational baseline freezes

Operator (you)             execution of CPT-suggested or Boss-ruled steps
                           paste output for verification
                           emergency disarm at any time, any mode
                           sign-off on cold-key actions
                           ultimate accountability for capital

WHEN TO ESCALATE

Anything that doesn't match a documented procedure → Boss
Anything that touches T3+ classification → Boss
Anything affecting CANONICAL_SURFACE.md → Boss
Anything in CHANGE_CONTROL.md "forbidden without ruling" list → Boss
Any unexpected behavior under live conditions → Boss
Operator fatigue beyond comfortable limits → STOP, sleep, return
```

---

## TIRED OPERATOR PROTOCOL

If you're tired, the rule is simple:

```
1. Stop ANY active rehearsal (pkill -f micro_live_oneshot.js).
2. Verify .env disarmed.
3. Stop the stack only if it's misbehaving; otherwise let it run idle.
4. Sleep.
5. Resume in the morning with a fresh head.
```

This is not optional. **Operator fatigue has been the cause of more trading-system disasters than any technical failure.** The bot watches; you sleep. That is by design.

---


## VERSION

```
v1.0 — 2026-04-22 — Boss ruling 2026-04-22 (Deployment Policy APPROVED)
v1.1 — 2026-05-07 — Boss ruling 2026-05-07 (Phase 3 sections added,
                     constitutional doc family referenced)
```
