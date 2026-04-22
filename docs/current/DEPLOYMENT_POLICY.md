# DEPLOYMENT POLICY + SESSION OPERATING RULES

Status: CURRENT  
Authority: Boss ruling 2026-04-22 — Capital Allocation + Execution Realism APPROVED  
Phase: Deployment Policy + Session Operating Rules

---

## SYSTEM CLASSIFICATION

```
Surface type:     PERSISTENT EDGE SURFACE
Edge type:        Venue inertia arbitrage (UniV3 0.01% ↔ Ramses V2 0.05%)
Chain:            Arbitrum mainnet
Constraint:       Capital deployment discipline (not timing, not detection)
```

---

## APPROVED OPERATING MODES

### CONSERVATIVE (entry mode)

| Parameter | Value |
|-----------|-------|
| Max trade size | $300 |
| Working capital | $315 |
| Capture rate | 65% |
| Expected session value | ~$527 |
| Expected value/hour | ~$13.67 |

Use when:
- Starting out
- Infrastructure is DEGRADED (but not COMPROMISED)
- Session is under 15 minutes old
- Capital is constrained

---

### STANDARD (default operating mode) ← recommended

| Parameter | Value |
|-----------|-------|
| Max trade size | $500 |
| Working capital | $525 |
| Capture rate | 88% |
| Expected session value | ~$705 |
| Expected value/hour | ~$18.29 |

Use when:
- Infrastructure is CLEAN or ACCEPTABLE
- Session age >= 15 minutes
- No active PAUSE conditions

This is the default. Start here unless capital or infrastructure forces CONSERVATIVE.

---

### AGGRESSIVE (selective only)

| Parameter | Value |
|-----------|-------|
| Max trade size | $1,000 |
| Working capital | $1,050 |
| Capture rate | 94% |
| Expected session value | ~$752 |
| Expected value/hour | ~$19.65 |

Use only when ALL of the following are true:
- Infrastructure is CLEAN (not just ACCEPTABLE)
- Session age >= 30 minutes
- Confirmed candidate rate >= 15/hour
- Operator explicitly enables it (not default)

Note: AGGRESSIVE adds only +$46/session over STANDARD for +$525 working capital.
Marginal capital efficiency is poor. Do not use as baseline.

---

### PAUSE (block all execution)

| Condition | Trigger |
|-----------|---------|
| Activator silent | > 10 minutes no output |
| Infrastructure COMPROMISED | > 5 sustained failures/hour |
| Provider rebuild failures | >= 4 failures in session |
| Session file missing | No active session |

---

## ALLOCATION CLASS POLICY

| Class | Definition | Action |
|-------|-----------|--------|
| CORE | Viable at $200 (spread >= 17.4 bps) | Always execute — anchor class |
| PROMOTED | Viable at $300–$500 (spread 13.6–17.4 bps) | Execute at minimum viable size |
| UPPER_BAND | Requires $750+ (spread 12.3–13.6 bps) | AGGRESSIVE mode only, guardrail required |
| STRUCTURAL_FAIL | Too thin even at $1000 (spread < 12.3 bps) | Skip permanently |
| NO_FILL | Replay gap / Infura freeze | Skip — infrastructure artifact |

---

## TRADE SIZING RULE (CRITICAL)

```
ALWAYS use the SMALLEST size that clears the VIABLE threshold ($0.10 net).
NEVER default to max size.
NEVER drift into upper-band without explicit guardrail check.
```

Sizing formula:
- If spread >= 17.4 bps → $200
- If spread >= 15.3 bps → $300
- If spread >= 13.6 bps → $500
- If spread >= 12.7 bps → $750 (AGGRESSIVE mode only)
- If spread >= 12.3 bps → $1,000 (AGGRESSIVE mode only)
- If spread < 12.3 bps → SKIP

---

## ESCALATION RULES

### CONSERVATIVE → STANDARD

Allowed when:
- Session age >= 15 minutes
- Infrastructure CLEAN or ACCEPTABLE
- No active PAUSE conditions

### STANDARD → AGGRESSIVE

Allowed only when:
- Session age >= 30 minutes
- Infrastructure CLEAN (not just ACCEPTABLE)
- Confirmed candidate rate >= 15/hour
- Operator explicitly invokes aggressive mode

### Any mode → PAUSE

Immediately on:
- Activator silent > 10 minutes
- Infrastructure COMPROMISED
- Rebuild failures >= 4

---

## DOWNGRADE RULES

| Current mode | Condition | Downgrade to |
|-------------|-----------|-------------|
| AGGRESSIVE | DEGRADED infrastructure | STANDARD |
| AGGRESSIVE | COMPROMISED infrastructure | PAUSE |
| STANDARD | > 5 sustained failures/hour | CONSERVATIVE |
| STANDARD | COMPROMISED | PAUSE |
| CONSERVATIVE | COMPROMISED | PAUSE |
| Any | Activator silent > 10 min | PAUSE |

---

## INFRASTRUCTURE HEALTH GRADES

Based on per-hour sustained failure rate (pool_read_stale + block_frozen events):

| Grade | Sustained failures/h | Rebuild failures | Meaning |
|-------|---------------------|-----------------|---------|
| CLEAN | 0 | 0 | Optimal — all modes eligible |
| ACCEPTABLE | <= 2/h | <= 3 total | Standard mode eligible |
| DEGRADED | <= 5/h | any | Conservative only |
| COMPROMISED | > 5/h | 4+ total | PAUSE — do not trade |

Note: Transient failures (pool_read_failed_5x) are NOT counted in this grade.
Only sustained stale/frozen events count.

---

## CONCURRENCY RULE

```
ONE TRADE AT A TIME — always.
Sequential execution only.
No queuing.
Working capital = max single trade size + 5% buffer.
```

---

## EXPECTED SESSION VALUE REFERENCE

These figures are based on 3-session analysis (Boss ruling 2026-04-22).
Actual session values vary with surface activity.

| Mode | Value/session | Value/hour | Capital needed |
|------|-------------|-----------|---------------|
| CONSERVATIVE | ~$527 | ~$13.67 | $315 |
| STANDARD | ~$705 | ~$18.29 | $525 |
| AGGRESSIVE | ~$752 | ~$19.65 | $1,050 |

---

## SESSION OPERATING CHECKLIST

Before every session:

```bash
# 1. Verify Redis
redis-cli ping

# 2. Pull latest code
cd ~/Allmight && git pull

# 3. Launch full stack (includes watchdog as Process 5)
nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 &
disown

# 4. After 15 minutes — check policy
node scripts/tools/session_policy_check.js

# 5. If STANDARD is approved — run at standard mode
# If CONSERVATIVE only — run conservative until infrastructure improves
```

---

## STOP CONDITIONS

Stop session and investigate if:
- Policy checker returns PAUSE
- Watchdog reports FAILED status in Discord
- Activator heartbeat alert fires in Discord
- Confirmed candidate rate drops to 0 for > 2 hours (surface may be inactive)

---

## BANKROLL RECOMMENDATION

| Scenario | Minimum bankroll | Notes |
|----------|----------------|-------|
| Conservative-only | $315 | Entry mode |
| Standard operations | $525 | Recommended target |
| Full aggressive | $1,050 | Not recommended as baseline |
| Buffer reserve | +$100 | Gas, slippage, unexpected costs |

**Recommended operating bankroll: $625** ($525 working capital + $100 reserve)

---

## POLICY VERSION

```
v1.0 — 2026-04-22
Authority: Boss ruling 2026-04-22 (Capital Allocation + Execution Realism)
Next review: After second clean endpoint is available
```
