# ARCHITECTURE_LOCK

**Status:** CONSTITUTIONAL — locked architectural law of AllMight.  
**Authority:** Boss-only. CPT cannot self-authorize any change to the principles in this document.  
**Purpose:** Prevent architectural mutation over time. Future assistants reading this file shall treat it as binding.

---

## Operating philosophy — the **IS** of AllMight

AllMight is a **deterministic, spread-first, fail-closed cross-venue arbitrage system** targeting on-chain DEX dislocations on a single canonical surface (see `CANONICAL_SURFACE.md`).

It executes when — and only when — a **measurable, simulatable, fee-aware spread** exceeds a Boss-approved profitability floor on the same block. It does not predict, infer, or estimate market direction. It does not act on opinion. It does not act on prior probability.

```
INPUTS                      live on-chain pool state, fee data, gas data
DECISION                    deterministic gate evaluation against Boss-locked
                              thresholds
OUTPUT                      execute / abstain — never "maybe later"
```

If the inputs do not justify execution, the answer is **abstain**. Abstaining is always a valid output.

---

## Operating philosophy — the **IS NOT** of AllMight

The following are **explicitly forbidden** as architectural patterns. Any future suggestion to add them — regardless of how compelling the framing — must be escalated to Boss for ruling, not implemented:

```
✘  PREDICTION ENGINES         no model that forecasts price, spread, or regime
✘  MACHINE-LEARNING GATING    no ML classifier deciding execute/abstain
✘  TECHNICAL ANALYSIS         no TA, SMC, ICT, supply-demand zones, fib, etc.
✘  PROBABILISTIC EXECUTION    no "X% chance of success → execute"
✘  AUTONOMOUS STRATEGY        no self-modifying thresholds or rules
✘  DIRECTIONAL BIAS           no long/short bias, no momentum, no breakout
✘  SIGNAL DENSITY OPTIMIZATION  no "let's emit more signals" without
                                 Boss-approved spread-band evidence
✘  CROSS-BLOCK SPREAD READS   spreads are valid only within the same block
✘  BLENDED HEAT/EXECUTION     heat is advisory only; never gates execution
✘  TVL AS LIQUIDITY METRIC    L×sqrtP active-tick depth is the only valid
                                 execution liquidity proxy
```

If a tool, suggestion, or PR introduces any of the above, it is **not an enhancement** — it is an architectural breach.

---

## Layer architecture

AllMight follows a strict pipeline. Each layer reads from the layer above and writes only to its own outputs:

```
┌──────────────────────────────────────────────────────────────┐
│  FETCHER LAYER          master fetcher → Redis               │
│  Role: ingest live pool state from RPC                        │
│  Forbidden: no execution logic, no gating, no thresholds      │
└──────────────────────────────────────────────────────────────┘
                                 ↓ Redis
┌──────────────────────────────────────────────────────────────┐
│  SCANNER LAYER          spread_monitor.py, surface scanners  │
│  Role: cross-venue comparison, surface health telemetry       │
│  Forbidden: no execution logic, no order placement, no runtime│
│             RPC reads in scanner loops. Offline / read-only   │
│             analysis tools may use RPC only when explicitly   │
│             Boss-approved.                                     │
└──────────────────────────────────────────────────────────────┘
                                 ↓ JSONL telemetry
┌──────────────────────────────────────────────────────────────┐
│  TIMESERIES / HEAT LAYER    surface_timeseries_monitor,      │
│                              arb_volatility_monitor,          │
│                              heat reporter                     │
│  Role: regime/volatility/heat classification (advisory only)  │
│  Forbidden: must NOT influence arm/execute eligibility.       │
│             Heat is annotation, not gating (Boss 2026-04-09)  │
└──────────────────────────────────────────────────────────────┘
                                 ↓ JSONL telemetry
┌──────────────────────────────────────────────────────────────┐
│  ACTIVATOR LAYER        arb_window_activator.js              │
│  Role: same-block snapshot, simulation, EXECUTION_READY       │
│        signal emission                                          │
│  Forbidden: no order placement, no broadcast, no .env mutation │
│             Same-block anchoring is mandatory                  │
└──────────────────────────────────────────────────────────────┘
                                 ↓ activator.jsonl
┌──────────────────────────────────────────────────────────────┐
│  EXECUTION LAYER        micro_live_oneshot.js, executor       │
│  Role: gate verification, callStatic dual-pass, broadcast,     │
│        post-trade flag flips                                   │
│  Forbidden: no signal generation, no regime inference,         │
│             no autonomous threshold modification               │
└──────────────────────────────────────────────────────────────┘
```

Layers must remain in this order. **Backward references are forbidden** (e.g., the activator must not call into a fetcher; the executor must not modify scanner state).

---

## Determinism rules

These are operational requirements, not stylistic preferences:

```
1. Same-block anchoring
   Spread reads across different blocks are 5–14× larger than reality
   and invalid for any classification or execution decision.

2. Verdict sets are controlled
   Every classification tool emits one of a fixed, documented set of
   verdicts. No ambiguous classifications. No string-typed free-form
   labels.

3. Append-only telemetry
   All long-running processes emit JSONL with structured event types
   to dedicated session files. No retroactive edits, no state mutation
   in the log layer.

4. Pipeline-compatible schema
   Every fetcher record carries:
     ts / source / chain / pair / protocol / pool / price /
     depthUsd / block / status
   Records missing required envelope fields are not pipeline-compatible.

5. RPC discipline
   - withTimeout() wraps every critical read
   - Promise.all is permitted ONLY within a single rpc.call() on the
     same contract — never across multiple contracts or broader blocks
   - Serial reads with inter-call sleep is the anti-stampede pattern
   - Three-level recovery ladder: warn → rebuild provider → exit non-zero

6. Active-tick depth is the only valid liquidity metric
   L × sqrtP for each active tick. Total TVL is irrelevant and
   misleading. The $10,000 active-tick depth floor is a Boss-locked
   hard rule requiring explicit ruling to lower.

7. Blocker classes are distinct
   blocked_fee, blocked_liquidity, blocked_slippage each require
   different remediation — never conflate them.
```

---

## Governance philosophy

```
DRY-FIRST                     every new execution path runs in dry mode
                              and proves itself in rehearsal before any
                              live capital can flow

FAIL-CLOSED                   every fail-closed catch holds. If the
                              system cannot prove an action is safe,
                              the action does not occur. There is no
                              graceful degradation toward execution.

LIVE-LOCKED BY DEFAULT        LIVE_DEPLOY_APPROVED defaults to false.
                              Boss must explicitly authorize each new
                              execution capability. The flag does not
                              persist across reboots, intentionally.

EXECUTION VALIDATION >        We measure success by whether trades
SIGNAL COUNT                  execute correctly and profitably under
                              real conditions, not by how many signals
                              the activator emits. A surface with
                              fewer, cleaner signals is preferred over
                              a surface with many noisy signals.

BOSS / CPT SPLIT              Boss authorizes architectural decisions,
                              classifications, thresholds, and rulings.
                              CPT (assistant) implements, validates, and
                              reports — and defers to Boss for any
                              judgment call.

NO RETROACTIVE THRESHOLD      A spread, depth, or fee threshold once
LOOSENING WITHOUT RULING      set requires explicit Boss ruling to lower,
                              even when markets are quiet.

DOC-FIRST WHEN STATE CHANGES  After any Boss-ruled state change, the
                              relevant doc (SYSTEM_STATE, CANONICAL_
                              SURFACE, etc.) must be updated before
                              the change is committed to git.
```

---

## What changes are forbidden without Boss ruling

See `CHANGE_CONTROL.md` for the full taxonomy. The following are categorically not CPT-authorizable:

```
✘  Any change to the canonical surface
✘  Any change to a Boss-locked threshold (24bps live floor,
   $10,000 active-tick depth floor, 26bps first-trade floor, etc.)
✘  Adding a layer to the architecture
✘  Removing a fail-closed catch
✘  Lowering a safety gate
✘  Adding any of the IS-NOT items above
✘  Changing the deployed executor's pool/token pins
✘  Multi-surface activation
✘  Live execution authorization
```

---

## What changes are CPT-authorizable

```
✓  Documentation (SAFE_DOC) — adds, clarifications, fixes
✓  Observability (SAFE_OBSERVABILITY) — log fields, audit script
   improvements, telemetry additions
✓  Read-only analytics (SAFE_ANALYTICS) — new reports, metric
   computations from existing data
✓  Boss-ruling implementation — any change Boss has explicitly
   authorized
✓  Patches that fix demonstrated bugs without changing thresholds
   or behavior contracts
```

When in doubt, the doubt is itself the answer: **escalate to Boss.**

---

## Anti-pattern catalog (lessons preserved as architectural law)

```
"Let's add a small ML predictor"
   → Forbidden by IS-NOT clause. Spread-first determinism is the system.

"This threshold is too strict; market is quiet"
   → Forbidden by NO RETROACTIVE LOOSENING. Quiet markets are valid
     telemetry. Either Boss approves a temporary rehearsal-only override
     (Option B precedent), or we wait.

"Let's run two surfaces in parallel for diversification"
   → Forbidden until single-surface live profitability is proven.
     Diversification is a PROVEN-system feature, not an in-development one.

"This pretty-printed line is fine in activator.jsonl"
   → No. JSONL files are JSON-only (Boss 2026-04-15). Pollution
     undermines parser determinism. start_all.sh stdout pollution
     queued for cleanup post-rehearsal.

"The shadow engine could decide live trades"
   → No. The shadow engine is forensic / educational only. Live trade
     decisions go through micro_live_oneshot.js, which uses deterministic
     gates against Boss-locked thresholds.

"We can skip same-block anchoring for performance"
   → Forbidden. Cross-block reads produce invalid spread data.

"The audit reports a warning, let's just suppress it"
   → No. Warnings get classified into one of three buckets:
     1. Action item — fix
     2. Boss-deferred waiver — document in active waivers
     3. False positive — fix the audit
     Never silently suppress.
```

---

## References

- `CANONICAL_SURFACE.md` — surface authority
- `SYSTEM_STATE.md` — runtime authority
- `CHANGE_CONTROL.md` — change classification taxonomy
- `OPERATOR_RUNBOOK.md` — operational procedures
- `INCIDENT_LOG.md` — historical lessons preserved as institutional memory

---

## Final clause

This document is the constitutional law of the AllMight architecture. The principles here are not subject to "let's just try it" exceptions. Future assistants and operators are bound by these rules until and unless Boss issues an explicit, dated ruling that supersedes a specific principle in this file.

When in doubt, do nothing.

That is always a safe outcome.
