# PROJECT ALLMIGHT — UNIFIED MASTER (CANONICAL SPINE)
Version: v2.2+ (Spine)
Date: 2026-01-05
Status: ACTIVE (append-only)

## 0) What this is
This is the canonical front door to Project AllMight.
It defines authority, scope, phase governance, and non-negotiables.
Large details live in companion docs.

## 1) Non-negotiables (governance in 60 seconds)
- Determinism > cleverness (replayable, hashable, reproducible decisions)
- Safety > opportunity (shadow-mode first; kill-switches mandatory)
- Append-only doctrine (patches + deltas; no silent rewrites)
- Build hygiene (no secrets committed; no generated artifacts unless declared canonical)

## 2) System purpose
AllMight is a modular, security-first, replayable trading + capital allocation engine designed to:
- harvest asymmetric opportunities (CEX/DEX, cross-chain, structural edges)
- compound via explicit vault routing (no “magic money”)
- avoid direct MEV competition where possible
- self-fund hardware upgrades over time
- remain survivable under degraded conditions

## 3) Architecture (high level)
- Layer 1: Inputs (deterministic, versioned)
- Layer 2: Engines (signals → state → scores)
- Layer 3: Execution (gated, audited, kill-switch controlled)

## 4) Phase model (authoritative pointer)
Full phase definitions and completion gates live in:
- `docs/specs/PHASE_MODEL_AND_EXIT_CRITERIA.md`

## 5) Capital & execution playbook (authoritative pointer)
Text-first capital routing and execution lane rules live in:
- `docs/specs/EXECUTION_AND_CAPITAL_PLAYBOOK.md`

## 6) Safety, risk & compliance (authoritative pointer)
Kill-switch doctrine, drawdown math, recovery, and US-first guardrails live in:
- `docs/specs/SAFETY_RISK_AND_KILL_DOCTRINE.md`

## 7) Rules of truth
- If it’s not linked in `docs/INDEX.md`, it’s not authoritative.
- Frozen/locked content changes only via patches + phase deltas.
