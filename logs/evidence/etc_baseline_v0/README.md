# ETC Baseline v0 — Pre-Correction Calibration Snapshot

## Purpose
This is the pristine pre-correction dataset of AllMight's shadow economic
models, preserved at the moment of discovery that shadow predictions
diverge systematically from contract execution reality.

Per Boss G2.12 mandate: "Do NOT immediately patch the economics model 
after finding the omission. ... You currently possess a pristine 
pre-correction calibration snapshot. That is extremely valuable 
historically. Preserve it."

## Source session
logs/sessions/session_20260522_0135/

## Key files
- blueprints_pre_correction.jsonl       (464 blueprints, shadow predictions)
- v2_survivors_pre_correction.jsonl     (58 candidates passing v2 filter)
- v2_totals_pre_correction.json
- contract_verdict_pre_correction.jsonl (58× INSUFFICIENT_PROFIT)
- contract_totals_pre_correction.json

## Key finding at time of snapshot
Shadow models predicted net profit $0.11-$0.37 per trade.
Contract simulation produced ≤1 wei profit (essentially zero) on all 58 v2 survivors.
Suspected root cause: Aave flash loan fee (5 bps) not subtracted in shadow economics.

## Status when preserved
- INCIDENT 020 RESOLVED (Boss G2.11)
- INCIDENT 015 RESOLVED (Boss G2.6)
- ETC Phase opened (Boss G2.11)
- Aave-fee hypothesis pending verification (Boss G2.12)
- No shadow model patches yet applied
