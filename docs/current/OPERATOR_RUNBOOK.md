# OPERATOR RUNBOOK + LAUNCH DISCIPLINE

Status: CURRENT  
Authority: Boss ruling 2026-04-22 — Deployment Policy APPROVED  
Phase: Operator Runbook + Launch Discipline

---

## MINIMUM REQUIRED PROCESSES FOR A VALID SESSION

A session only counts when ALL five processes are running:

| # | Process | Script | Output |
|---|---------|--------|--------|
| 1 | Fetcher loop | `scripts/master-fetcher.js` | `session/fetcher.log` |
| 2 | Volatility monitor | `scripts/analysis/arb_volatility_monitor.js` | `session/volatility.jsonl` |
| 3 | Heat report runner | `scripts/tools/volatility_divergence_report.js` | `session/heat.jsonl` |
| 4 | Activator (supervised) | `scripts/analysis/arb_window_activator.js` | `session/activator.jsonl` |
| 5 | Watchdog loop | `scripts/tools/allmight_watchdog.sh` | `session/watchdog.jsonl` |

If any of 1–4 is missing: session is invalid — stop and restart.  
If 5 (watchdog) is missing: session may run but no Discord health alerts fire — launch watchdog immediately.

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

## VERSION

```
v1.0 — 2026-04-22
Authority: Boss ruling 2026-04-22 (Deployment Policy APPROVED)
```
