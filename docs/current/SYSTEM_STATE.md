# SYSTEM_STATE

**Status:** AUTHORITATIVE — single source of truth for what is deployed and running.  
**Policy:** This document is updated **only after** a verified state change (Boss-ruled patch + audit pass). Memory and chat history defer to this file.  
**Last verified:** 2026-05-07 (post Boss A1+B1+B2+I4 corrections)

---

## Phase posture

```
PHASE                       Phase 3 — Execution design, deploy, rehearsal
EXECUTION POSTURE           DEPLOYED + DRY-LOCKED
LIVE TRADE STATUS           NEVER OCCURRED
CAPITAL DEPLOYED ON-CHAIN   $0.18 USD (executor deploy gas only)
CAPITAL AT RISK             $0
```

## Deployed contract

```
NAME                        AllMightRamsesExecutor
ADDRESS                     0xd2eaa2B2E0c475e418B1682d321eD77558D1b5Fb
CHAIN                       Arbitrum One (chainId 42161)
DEPLOY TX                   0x55b7b7eeab6e017d4b688eb69a6cd38d4b71fd0eba0ceb9a875afa0d6b206dd8
OWNER                       0x811dA34A55e16D6C88feB8042c44A16c33dEf188
PROFIT_RECIPIENT            0x811dA34A55e16D6C88feB8042c44A16c33dEf188
                              ⚠ Same as owner — split to cold wallet
                                deferred per Boss until post-first-trade
PREFLIGHT VERIFIED          28 / 28 checks passed
PIN: WETH                   0x82aF49447D8a07e3bd95BD0d56f35241523fBab1
PIN: USDC                   0xaf88d065e77c8cC2239327C5EDb3A432268e5831
                            (canonical native USDC, NOT bridged)
```

## Active surface

See `CANONICAL_SURFACE.md` for full details. Summary:

```
PRIMARY                     ETH/USDC-RAMSES (Ramses V2 0x30AF...4110)
WATCHLIST (inactive)        ARB/USDC, ETH/USDT, DAI/USDC, ETH/USDC (UniV3+Camelot)
ETHEREUM MAINNET            WATCHLIST only, no active surfaces
```

## Runtime flags (.env)

```
LIVE_DEPLOY_APPROVED        false   ← live execution gate
AUTO_MICRO_ONESHOT          false   ← live arming gate
TICK_MAP_ALWAYS_REFRESH     true    ← Boss B1 (deadlock prevention)
EXECUTOR_ADDRESS            0xd2eaa2B2E0c475e418B1682d321eD77558D1b5Fb
PROFIT_RECIPIENT_ADDRESS    0x811dA34A55e16D6C88feB8042c44A16c33dEf188
.env mode                   600 (locked to owner)
.gitignore coverage         .env, .env.*, .env.bak* — private key cannot leak
```

## Active rehearsal policy

```
REHEARSAL_MIN_SPREAD_BPS    20     (Boss-approved Option B, dry-mode-only)
LIVE FIRST-TRADE FLOOR      26 bps (Boss-locked, never lowered for first trade)
LIVE HARD FLOOR             24 bps (Boss-locked, hard rule for any live trade)
SIZE CAP (first trade)      $25
GAS CAP                     0.05 gwei (Arbitrum)
DAILY LOSS CAP              $5
DAILY TRADE CAP             1
LOCK-AFTER-TRADE            mandatory on first live trade
```

## Active processes (canonical 8)

Launched by `scripts/tools/start_all.sh`:

```
fetcher                     master fetcher → Redis (price feeds)
activator                   arb_window_activator.js --pair=ETH/USDC-RAMSES
volatility                  arb_volatility_monitor.js
heat                        volatility_divergence_report.js (heat reporter)
monitor                     spread_monitor.py
watchdog                    allmight_watchdog.sh --loop 60
notification_router         notification_router.js (Discord)
shadow_engine               shadow execution engine (5-min poll)
```

Background process when rehearsing:
```
micro_live_oneshot          micro_live_oneshot.js (dry/live one-shot executor)
                            launched ad-hoc, NOT supervised by start_all.sh
```

## Discord channels

```
ops                         system health, watchdog, timeouts, fatals
candidate                   trade candidates: dry-pass, submit, success, revert
summary                     session digests on stop
```

All three webhook URLs verified present in `.env` and tested by `audit_rehearsal_wiring.sh`.

## RPC posture

```
PROVIDER FACTORY            scripts/utils/provider_factory.js
PRIMARY (slot 0)            Alchemy (Arbitrum + Ethereum)
FALLBACKS                   Infura, Ankr
ROUTING                     freshness-aware, lag penalty tiers,
                            round-robin within freshest tier
TIMEOUT GUARD               withTimeout() on all critical reads
RECOVERY LADDER             warn → rebuild provider → exit non-zero
```

## Watchdog acceptable-warning baseline

The system_integrity_audit.sh treats these as ⚠ advisories, not failures:

```
"<5 node processes" detected           false-positive grep too narrow
volatility.jsonl missing pair field    schema gap, not drift
heat.jsonl missing pair field          schema gap, not drift  
heat.jsonl no heatClass yet            cascades from cold-start
1 STATE_UNHEALTHY from RPC freeze      pool_read_stale or block_frozen,
                                        self-recovers, NOT tickmap-related
```

These are documented in `SYSTEM_INTEGRITY_BASELINE.md` for cross-reference.

## Canonical C9 sessions

Boss-validated sessions for regression baseline:

```
20260428_2329
20260503_1948
20260505_0755
```

## Audit tooling

```
audit_rehearsal_wiring.sh           pre-rehearsal preflight (10 sections)
system_integrity_audit.sh           deep system audit (10 sections)
```

Both scripts are read-only, fail loud, and run in <5 minutes.

## Boss rulings currently in effect

```
2026-04-04   Ramses V2 surface promotion
2026-04-09   Heat advisory only (never gates execution)
2026-04-10   Size policy $200 execution-validated for ETH/USDC-RAMSES
2026-04-15   activator.jsonl JSON-only (currently violated by start_all.sh
              stdout pollution; queued for cleanup post-rehearsal)
2026-05-05   Deploy executor authorization
2026-05-05   Build micro_live_oneshot.js
2026-05-07   A1 — pair retarget to ETH/USDC-RAMSES
2026-05-07   B1 — TICK_MAP_ALWAYS_REFRESH=true
2026-05-07   B2 — hard-cap age override patch
2026-05-07   I4 — infrastructure validation PASSED
2026-05-07   Option B — REHEARSAL_MIN_SPREAD_BPS=20 dry-only override
2026-05-07   Phase H1 RPC freeze observability hardening — queued post-rehearsal
2026-05-07   Operational baseline freeze — this doc and 4 others lock state
```

## Active waivers / known gaps

```
start_all.sh stdout pollution        violates 2026-04-15 ruling; queued
.bash_profile orphan                  scripts/execution/execution_gate_score.js.pre-nan.bak
                                       harmless artifact from May 2; ignored
audit script "0\n0" cosmetic bug      grep -c subshell quoting; counts
                                       still correct in human-readable form
profit recipient = owner             single-wallet concentration risk;
                                       Boss deferred split until post-first-trade
```

## What's NOT yet validated at runtime

```
[4] lock-after-trade behavior        DRY_MODE_LOCK_PLAN emission requires
                                      a qualifying ≥20bps EXECUTION_READY signal;
                                      pending rehearsal #3 (PID 346412, 12h window)
G3 first-trade authorization         Boss ruling pending 5/5 evidence
First live trade                     not yet attempted
Phase H1 hardening                    queued (Boss: post-rehearsal only)
```

## Last verified

```
DATE                        2026-05-07 17:56 UTC
SESSION                     20260506_2259
AUDIT                       system_integrity_audit.sh — 22 pass, 4 warn, 1 fail
                              (the 1 fail is "no signal in last 100 lines",
                               cosmetic strict-mode known limitation)
ON-CHAIN                    executor bytecode confirmed at 0xd2eaa2…b5Fb
                              wallet 0.042322 ETH, gas 0.0200 gwei
PIPELINE                    1,491 signals in 13.8h session, EXECUTION_READY
                              records emitting on ETH/USDC-RAMSES
```

---

## Reference

This file is the truth. If chat memory, code comments, or other docs disagree with this file, **this file wins** until it is updated by an explicit Boss ruling.

For deeper detail:
- Surface specifics → `CANONICAL_SURFACE.md`
- Architectural rules → `ARCHITECTURE_LOCK.md`
- Operational procedures → `OPERATOR_RUNBOOK.md`
- Change governance → `CHANGE_CONTROL.md`
