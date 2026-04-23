# BOSS SESSION PACK  v1.0

Status: CURRENT  
Authority: Boss ruling 2026-04-22  
Purpose: Single reference for every session — launch, operate, report

---

## CANONICAL LAUNCH BUNDLE

Copy-paste exactly. Every session. No variation.

```bash
# ── 1. Redis gate ──────────────────────────────────────────────────────────────
redis-cli ping
# Must return: PONG — do not proceed otherwise

# ── 2. Latest code ─────────────────────────────────────────────────────────────
cd ~/Allmight && git pull

# ── 3. Launch full stack ───────────────────────────────────────────────────────
nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 &
disown

# ── 4. Wait 5 minutes, then verify ────────────────────────────────────────────
bash scripts/tools/start_all.sh status        # all 5 must show RUNNING
node scripts/tools/session_policy_check.js    # must show STANDARD or CONSERVATIVE
```

Expected: Discord shows `🟢 ALLMIGHT STARTED — YYYYMMDD_HHMM`  
If no Discord message after 2 min: notifier is broken — fix before trusting alerts.

---

## CANONICAL STATUS CHECK

```bash
bash scripts/tools/start_all.sh status        # process health
node scripts/tools/session_policy_check.js    # approved mode
```

Run this any time you want a snapshot. Also runs automatically as part of the heartbeat.

---

## CANONICAL STOP + WRAP

```bash
bash scripts/tools/start_all.sh stop          # stop all + run analysis + compress
bash scripts/tools/start_all.sh upload        # show zip path and artifact list
```

Post-stop pipeline runs automatically (9 steps, ~2 min). Do not interrupt.

---

## PRE-SESSION CHECKLIST

Before any session counts as valid:

- [ ] `redis-cli ping` → PONG
- [ ] `git pull` → no errors
- [ ] `start_all.sh status` → all 5 processes RUNNING
- [ ] `session_policy_check.js` → STANDARD or CONSERVATIVE (not PAUSE)
- [ ] `heat.jsonl` has ≥ 3 lines (activator warmed up)
- [ ] Discord startup notification received
- [ ] No prior session zip left unreviewed

---

## IN-SESSION CHECKLIST

Every 30–60 min during unattended operation:

- [ ] Discord heartbeat is arriving every ~5 min
- [ ] No PAUSE or FAILED alerts in Discord
- [ ] `start_all.sh status` still shows all 5 RUNNING (if checking manually)
- [ ] Session policy not downgraded unexpectedly

---

## POST-SESSION CHECKLIST

After `start_all.sh stop`:

- [ ] `analysis.log` shows no `✗` failures
- [ ] `sandbox_results.json` exists and viable% > 0
- [ ] `watchdog.jsonl` exists (confirms watchdog ran all session)
- [ ] `execution_candidate_audit.jsonl` exists and has records
- [ ] Zip file created: `logs/session_YYYYMMDD_HHMM.zip`
- [ ] Discord stop summary received

Optional (recommended for Boss review sessions):

```bash
node scripts/tools/adaptive_size_report.js \
  --blueprints logs/session_YYYYMMDD_HHMM/blueprints.jsonl \
  --replay     logs/session_YYYYMMDD_HHMM/price_replay.jsonl

node scripts/tools/capital_allocation_report.js \
  --blueprints logs/session_YYYYMMDD_HHMM/blueprints.jsonl \
  --replay     logs/session_YYYYMMDD_HHMM/price_replay.jsonl \
  --mode standard

node scripts/tools/session_policy_check.js \
  --session logs/session_YYYYMMDD_HHMM
```

---

## REQUIRED ARTIFACT CHECKLIST

A session is valid for Boss review when ALL of these are present:

| Artifact | Required | Minimum content |
|----------|----------|----------------|
| `activator.jsonl` | ✅ | heartbeat + signal records |
| `blueprints.jsonl` | ✅ | ≥ 1 blueprint |
| `execution_candidate_audit.jsonl` | ✅ | ≥ 1 record |
| `price_replay.jsonl` | ✅ | ≥ 100 rows |
| `watchdog.jsonl` | ✅ | ≥ 1 record |
| `heat.jsonl` | ✅ | ≥ 3 records |
| `sandbox_results.json` | ✅ | viable% > 0 |
| `size_ladder.json` | ✅ | all 5 ladder steps |
| `analysis.log` | ✅ | no `✗` failures |
| `threshold_edge_accumulator.json` | optional | if ≥ 2 prior sessions |
| `sandbox_accumulator.json` | optional | if ≥ 2 prior sessions |

If any required artifact is missing: session is incomplete — note in Boss report.

---

## BOSS SESSION SUMMARY TEMPLATE

Use this format for every session submitted to Boss:

```
SESSION: YYYYMMDD_HHMM
Duration: Xh  |  Start: YYYY-MM-DD HH:MM  →  End: YYYY-MM-DD HH:MM

── DETECTION ─────────────────────────────────────────────────────
Signals:             X
Blueprints:          X
Confirmed (Band A):  X  (X.X/h)
Near-miss:           X
Avg spread:          X.XXXX%
Max spread:          X.XXXX%

── EXECUTION SANDBOX ─────────────────────────────────────────────
Viable at 0ms:       X%
Viable at 500ms:     X%
Viable at 1000ms:    X%
Avg net (viable):    $X.XXXX
Capture ceiling:     X% (adaptive model)

── SIZE LADDER (Band A) ──────────────────────────────────────────
$200:   X%  $X.XXXX avg
$300:   X%  $X.XXXX avg
$500:   X%  $X.XXXX avg
$750:   X%  $X.XXXX avg
$1000:  X%  $X.XXXX avg

── CAPITAL ALLOCATION (standard mode) ───────────────────────────
CORE trades:         X  (X%)  $X.XX value
PROMOTED trades:     X  (X%)  $X.XX value
Session value:       $X.XX
Value/hour:          $X.XX

── INFRASTRUCTURE ────────────────────────────────────────────────
Mode:                STANDARD / CONSERVATIVE
Infra grade:         CLEAN / ACCEPTABLE / DEGRADED
STATE_UNHEALTHY:     X (sustained: X, transient: X)
Provider rebuilds:   X ok / X fail
Activator silent:    yes / no
Watchdog ran:        yes / no

── ANOMALIES ─────────────────────────────────────────────────────
[list any issues, pauses, restarts, or unexpected behavior]

── NEXT MOVE ─────────────────────────────────────────────────────
[what should happen next based on this session's results]
```

---

## OPERATING MODE QUICK REFERENCE

| Mode | When to use | Max size | Working capital | Capture |
|------|------------|---------|----------------|---------|
| **STANDARD** | Default | $500 | $525 | 88% |
| CONSERVATIVE | Young session / degraded infra | $300 | $315 | 65% |
| AGGRESSIVE | Clean infra + rate≥15/h + explicit | $1,000 | $1,050 | 94% |
| PAUSE | Silent activator / compromised infra | — | — | 0% |

---

## VERSION

```
v1.0 — 2026-04-22
Authority: Boss ruling 2026-04-22
```
