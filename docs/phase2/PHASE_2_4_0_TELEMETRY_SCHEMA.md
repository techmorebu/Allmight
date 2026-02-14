# PHASE 2.4.0 — TELEMETRY SCHEMA (EXECUTION HARDENING)

Status: CANONICAL (Phase 2.4.0)
Scope: Latency + Outcome Instrumentation for Execution Hardening
Authority: Phase-0 Governance (Determinism / Replay / Audit)

---

## 1) Context

Phase 2.4 requires measurement-first execution hardening.
This file defines the telemetry contract used to:
- measure stage-by-stage latency
- classify rejection causes deterministically
- track bundle simulation outcomes
- track submission/inclusion/revert/profit outcomes
- compute capture metrics (CaptureRate, BundleWinRate, RevertRate, LossRate)

All logs MUST be replay-safe:
- deterministic keys
- stable numeric rounding policy
- append-only JSONL
- explicit reason codes (no silent rejects)

---

## 2) Storage Format (JSONL)

All telemetry is recorded as append-only JSON Lines:

data/telemetry/YYYYMMDD/{namespace}.jsonl

Namespaces (minimum):
- pipeline_events.jsonl
- preflight_results.jsonl
- bundle_sim_results.jsonl
- submission_results.jsonl
- execution_receipts.jsonl
- summary_rollups.jsonl (optional daily summary; derived)

Rules:
- One JSON object per line.
- No mutation of historical lines.
- Each line must include: ts_ms, run_id, event_type, opportunity_id.

---

## 3) Identity Fields (Required Everywhere)

Every telemetry event MUST include:

- ts_ms: int
- run_id: str
  - stable id for a run/session (e.g., UTC timestamp + git short hash)
- opportunity_id: str
  - stable hash of (chain_id, venue_id, market_id, route_id, notional_tier, block_ref)
- chain_id: str
- venue_id: str
- market_id: str
- route_id: str
  - stable identifier for the route shape (e.g., token path + fee tiers)
- notional_usd: float
- block_ref: int
  - the block number used for state-bounded simulation (block N)
- block_target: int | null
  - typically N+1 for bundle targeting, else null

---

## 4) Stage Timing Events (pipeline_events.jsonl)

### 4.1 Event Types
- PIPELINE_STAGE_BEGIN
- PIPELINE_STAGE_END

### 4.2 Required Fields
- event_type: str
- stage: str
  - DETECT
  - SNAPSHOT_FETCH
  - NORMALIZE
  - PREFLIGHT
  - ROUTE_SIM
  - BUNDLE_BUILD
  - BUNDLE_SIM
  - SUBMIT
  - INCLUDE_CONFIRM
- stage_seq: int
  - monotonic within opportunity_id
- t_start_ms: int (for *_BEGIN)
- t_end_ms: int (for *_END)
- duration_ms: int (for *_END)

### 4.3 Optional Fields
- notes: str | null
- error_code: str | null
- error_detail: str | null

---

## 5) Preflight Results (preflight_results.jsonl)

### 5.1 Preflight Result Enum
- REJECT
- ACCEPT_SIM_ONLY
- ACCEPT_BUNDLE

### 5.2 Required Fields
- event_type: "PREFLIGHT_RESULT"
- preflight_result: str
- rejection_reason_code: str | null
- confidence_level: str
  - LOW | MED | HIGH
- net_edge_bps: float
- safety_buffer_bps: float
- min_profit_wei: int
- max_gas_wei: int

### 5.3 Canonical Rejection Reason Codes
Minimum set (extendable, but never rename/remove without migration):
- REJ_NETEDGE_BELOW_BUFFER
- REJ_SLIPPAGE_TOO_HIGH
- REJ_GAS_TOO_HIGH
- REJ_GAS_COVERAGE_RATIO_LOW
- REJ_STATE_DRIFT_RISK
- REJ_COMPETITION_DENSITY_HIGH
- REJ_SIMULATION_FAILED
- REJ_BUNDLE_SIM_UNPROFITABLE
- REJ_BUNDLE_SIM_REVERTS
- REJ_POLICY_FORBIDDEN

---

## 6) Route Simulation Results (optional: route_sim_results.jsonl)

If stored separately, use:

- event_type: "ROUTE_SIM_RESULT"
- sim_ok: bool
- sim_error_code: str | null
- sim_error_detail: str | null

Core numeric outputs (required when sim_ok true):
- mid_px: float
- buy_px_1k: float
- sell_px_1k: float
- buy_px_5k: float
- sell_px_5k: float
- buy_px_10k: float
- sell_px_10k: float
- spread_bps_1k: float
- slippage_bps_1k: float
- slippage_bps_5k: float
- slippage_bps_10k: float

Cost model outputs:
- swap_fee_bps: float
- gas_cost_wei_est: int
- gas_cost_usd_est: float
- flash_loan_fee_bps: float | null
- latency_ms_est: int

State drift model:
- drift_buffer_bps: float
- fee_variance_buffer_bps: float
- competition_buffer_bps: float
- total_buffer_bps: float

---

## 7) Bundle Simulation Results (bundle_sim_results.jsonl)

### 7.1 Required Fields
- event_type: "BUNDLE_SIM_RESULT"
- bundle_id: str
- sim_block_target: int
- sim_ok: bool
- sim_revert: bool
- sim_revert_reason: str | null
- gross_profit_wei_sim: int
- gas_used_wei_sim: int
- gas_price_wei_sim: int
- net_profit_wei_sim: int
- gas_coverage_ratio: float
  - net_profit_wei_sim / gas_used_wei_sim (or defined policy)
- decision: str
  - REJECT | SUBMIT

### 7.2 Notes
If sim_ok is false, provide:
- sim_error_code
- sim_error_detail

---

## 8) Submission Results (submission_results.jsonl)

### 8.1 Required Fields
- event_type: "SUBMISSION_RESULT"
- bundle_id: str
- submitted: bool
- submit_channel: str
  - FLASHBOTS | PRIVATE_RPC | OTHER
- submit_ok: bool
- submit_error_code: str | null
- submit_error_detail: str | null

---

## 9) Inclusion / Outcome Results (submission_results.jsonl or separate inclusion_results.jsonl)

### 9.1 Required Fields
- event_type: "INCLUSION_RESULT"
- bundle_id: str
- target_block: int
- included: bool
- included_tx_hashes: list[str] | null
- reverted: bool
- revert_reason: str | null
- gross_profit_wei_real: int | null
- gas_spent_wei_real: int | null
- net_profit_wei_real: int | null

---

## 10) On-Chain Execution Receipts (execution_receipts.jsonl)

If your contract emits receipt events, log:
- event_type: "EXECUTION_RECEIPT"
- tx_hash: str
- block_number: int
- contract: str
- receipt_event_name: str
- route_hash: str
- profit_token: str
- profit_amount: str (string to preserve bigints)
- gas_used: int
- status: str
  - SUCCESS | REVERT

---

## 11) Derived Metrics (summary_rollups.jsonl)

Daily (or per-run) derived metrics, computed from raw logs:
- event_type: "ROLLUP"
- window: str (e.g., "2026-02-13T00:00Z/2026-02-13T01:00Z")
- detected_count: int
- preflight_reject_count: int
- preflight_accept_sim_only_count: int
- preflight_accept_bundle_count: int
- simulated_count: int
- submitted_count: int
- included_count: int
- reverted_count: int
- profitable_count: int

Rates:
- capture_rate: float
  - profitable_count / detected_count
- bundle_win_rate: float
  - included_count / submitted_count
- revert_rate: float
  - reverted_count / submitted_count
- execution_loss_rate: float
  - gas_lost / gross_profit (policy-defined)

Expansion gate evaluation:
- expansion_gate_pass: bool
- expansion_gate_detail: str

---

## 12) Example JSONL Lines

### 12.1 Pipeline Stage Timing
{"ts_ms":1739400000000,"run_id":"P24_20260213_ab12cd3","event_type":"PIPELINE_STAGE_BEGIN","opportunity_id":"opp_9f2c...","chain_id":"eth","venue_id":"uniswap_v3","market_id":"0xpool...","route_id":"ETH->USDC_v3_500","notional_usd":1000.0,"block_ref":21876543,"block_target":21876544,"stage":"PREFLIGHT","stage_seq":3,"t_start_ms":1739400000000}
{"ts_ms":1739400000048,"run_id":"P24_20260213_ab12cd3","event_type":"PIPELINE_STAGE_END","opportunity_id":"opp_9f2c...","chain_id":"eth","venue_id":"uniswap_v3","market_id":"0xpool...","route_id":"ETH->USDC_v3_500","notional_usd":1000.0,"block_ref":21876543,"block_target":21876544,"stage":"PREFLIGHT","stage_seq":3,"t_end_ms":1739400000048,"duration_ms":48}

### 12.2 Preflight Result (Reject)
{"ts_ms":1739400000050,"run_id":"P24_20260213_ab12cd3","event_type":"PREFLIGHT_RESULT","opportunity_id":"opp_9f2c...","chain_id":"eth","venue_id":"uniswap_v3","market_id":"0xpool...","route_id":"ETH->USDC_v3_500","notional_usd":1000.0,"block_ref":21876543,"block_target":21876544,"preflight_result":"REJECT","rejection_reason_code":"REJ_NETEDGE_BELOW_BUFFER","confidence_level":"MED","net_edge_bps":1.7,"safety_buffer_bps":3.5,"min_profit_wei":0,"max_gas_wei":0}

### 12.3 Bundle Simulation Result (Submit)
{"ts_ms":1739400001120,"run_id":"P24_20260213_ab12cd3","event_type":"BUNDLE_SIM_RESULT","opportunity_id":"opp_a13e...","chain_id":"eth","venue_id":"uniswap_v3","market_id":"0xpool...","route_id":"ETH->USDC_v3_500","notional_usd":1000.0,"block_ref":21876543,"block_target":21876544,"bundle_id":"bndl_441a...","sim_block_target":21876544,"sim_ok":true,"sim_revert":false,"sim_revert_reason":null,"gross_profit_wei_sim":42000000000000000,"gas_used_wei_sim":21000000000000000,"gas_price_wei_sim":25000000000,"net_profit_wei_sim":21000000000000000,"gas_coverage_ratio":2.0,"decision":"SUBMIT"}

### 12.4 Submission Result
{"ts_ms":1739400001160,"run_id":"P24_20260213_ab12cd3","event_type":"SUBMISSION_RESULT","opportunity_id":"opp_a13e...","chain_id":"eth","venue_id":"uniswap_v3","market_id":"0xpool...","route_id":"ETH->USDC_v3_500","notional_usd":1000.0,"block_ref":21876543,"block_target":21876544,"bundle_id":"bndl_441a...","submitted":true,"submit_channel":"FLASHBOTS","submit_ok":true,"submit_error_code":null,"submit_error_detail":null}

### 12.5 Inclusion Result
{"ts_ms":1739400002450,"run_id":"P24_20260213_ab12cd3","event_type":"INCLUSION_RESULT","opportunity_id":"opp_a13e...","chain_id":"eth","venue_id":"uniswap_v3","market_id":"0xpool...","route_id":"ETH->USDC_v3_500","notional_usd":1000.0,"block_ref":21876543,"block_target":21876544,"bundle_id":"bndl_441a...","target_block":21876544,"included":true,"included_tx_hashes":["0xabc..."],"reverted":false,"revert_reason":null,"gross_profit_wei_real":41500000000000000,"gas_spent_wei_real":20500000000000000,"net_profit_wei_real":21000000000000000}

---

END OF DOCUMENT
