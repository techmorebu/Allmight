# PHASE 2.4.0 — TELEMETRY SCHEMA (EXECUTION HARDENING)

**Status:** CANONICAL (Phase 2.4.0 - Updated with Schema Versioning)  
**Scope:** Latency + Outcome Instrumentation for Execution Hardening  
**Authority:** Phase-0 Governance (Determinism / Replay / Audit)

**Last Updated:** 2026-02-18 - Added schema versioning, TELEMETRY_WARNING, validation layer

---

## 1) Context

Phase 2.4 requires measurement-first execution hardening.
This file defines the telemetry contract used to:
- measure stage-by-stage latency
- classify rejection causes deterministically
- track bundle simulation outcomes
- track submission/inclusion/revert/profit outcomes
- compute capture metrics (CaptureRate, BundleWinRate, RevertRate, LossRate)
- validate data quality and emit warnings

All logs MUST be replay-safe:
- deterministic keys
- stable numeric rounding policy
- append-only JSONL
- explicit reason codes (no silent rejects)
- **schema versioning for evolution**

---

## 2) Storage Format (JSONL)

All telemetry is recorded as append-only JSON Lines:

```
data/telemetry/YYYYMMDD/{namespace}.jsonl
```

Namespaces (minimum):
- `pipeline_events.jsonl` - Stage timing events
- `preflight_results.jsonl` - Accept/reject decisions
- `bundle_sim_results.jsonl` - Bundle simulation outcomes
- `submission_results.jsonl` - Submission attempts
- `execution_receipts.jsonl` - On-chain receipts
- `telemetry_warnings.jsonl` - **NEW: Validation warnings/errors**
- `summary_rollups.jsonl` - (optional daily summary; derived)

**Rules:**
- One JSON object per line
- No mutation of historical lines
- Each line must include: **`schema_version`**, `ts_ms`, `run_id`, `event_type`, `opportunity_id`
- Legacy files without `schema_version` are treated as version 0 (deprecated)

---

## 3) Schema Versioning (GOVERNANCE)

### 3.1 Required Field: `schema_version`

**ALL telemetry events MUST include:**

```json
{
  "schema_version": 1,
  ...
}
```

**Current version:** `1`

### 3.2 Versioning Rules

**Within a schema version (additive changes allowed):**
- ✅ Add new optional fields
- ✅ Add new enum values (codes, stage names)
- ✅ Add new event types
- ❌ NEVER rename existing fields
- ❌ NEVER change field meanings
- ❌ NEVER change units (ms → s, bps → pct)
- ❌ NEVER change types (int → str)

**Breaking changes require version bump:**
- Field renamed → bump to v2
- Unit changed → bump to v2
- Formula changed → bump to v2
- opportunity_id hash inputs changed → bump to v2

### 3.3 Backward Compatibility Policy

**Analytics must:**
- Accept multiple schema versions
- Default to v1 behavior when fields missing
- Never crash on unknown extra fields
- Treat missing `schema_version` as legacy (v0)

**Example:**
```python
schema_version = event.get('schema_version', 0)  # Legacy if missing

if schema_version >= 1:
    # Use new field if available
    edge = event.get('net_edge_bps')
else:
    # Fallback for legacy
    edge = 0
```

---

## 4) Identity Fields (Required Everywhere)

Every telemetry event MUST include:

```json
{
  "schema_version": 1,           // REQUIRED (governance)
  "ts_ms": 1739400000000,        // REQUIRED
  "run_id": "P24_20260213_abc",  // REQUIRED
  "event_type": "...",           // REQUIRED
  "opportunity_id": "opp_...",   // REQUIRED
  "chain_id": "eth",             // REQUIRED
  "venue_id": "uniswap_v3",      // REQUIRED
  "market_id": "0xpool...",      // REQUIRED
  "route_id": "ETH->USDC_v3",    // REQUIRED
  "notional_usd": 1000.0,        // REQUIRED
  "block_ref": 21876543,         // REQUIRED
  "block_target": 21876544       // OPTIONAL (null if not applicable)
}
```

**Field Definitions:**

- **`schema_version`**: int >= 1 (governance field)
- **`ts_ms`**: int - Event timestamp (milliseconds since epoch)
- **`run_id`**: str - Stable session ID (e.g., `P24_YYYYMMDD_hash`)
- **`opportunity_id`**: str - Stable hash of (chain_id, venue_id, market_id, route_id, notional_tier, block_ref)
- **`chain_id`**: str - Blockchain identifier (e.g., "eth", "arbitrum")
- **`venue_id`**: str - DEX identifier (e.g., "uniswap_v3", "sushiswap_v2")
- **`market_id`**: str - Pool/market address
- **`route_id`**: str - Stable route identifier (e.g., token path + fee tiers)
- **`notional_usd`**: float - Trade size in USD
- **`block_ref`**: int - Block number for state-bounded simulation (block N)
- **`block_target`**: int | null - Target block for bundle (typically N+1)

---

## 5) Stage Timing Events (pipeline_events.jsonl)

### 5.1 Event Types
- `PIPELINE_STAGE_BEGIN`
- `PIPELINE_STAGE_END`

### 5.2 Required Fields
```json
{
  "schema_version": 1,
  "event_type": "PIPELINE_STAGE_END",
  "stage": "PREFLIGHT",
  "stage_seq": 3,
  "t_start_ms": 1739400000000,  // for BEGIN
  "t_end_ms": 1739400000048,    // for END
  "duration_ms": 48              // for END
}
```

**Stage Names (canonical):**
- `DETECT` - Opportunity detection
- `SNAPSHOT_FETCH` - Market data collection
- `NORMALIZE` - Data normalization
- `PREFLIGHT` - Accept/reject decision
- `ROUTE_SIM` - Route simulation
- `BUNDLE_BUILD` - Bundle construction
- `BUNDLE_SIM` - Bundle simulation
- `SUBMIT` - Submission to relay
- `INCLUDE_CONFIRM` - Inclusion confirmation

### 5.3 Optional Fields
- `notes`: str | null - Human-readable notes
- `error_code`: str | null - Error code if stage failed
- `error_detail`: str | null - Error details

**Contract Test:** Must have `duration_ms >= 0` for `PIPELINE_STAGE_END` events.

---

## 6) Preflight Results (preflight_results.jsonl)

### 6.1 Preflight Result Enum
- `REJECT` - Opportunity rejected
- `ACCEPT_SIM_ONLY` - Accepted for simulation only (not bundle)
- `ACCEPT_BUNDLE` - Accepted for bundle execution

### 6.2 Required Fields
```json
{
  "schema_version": 1,
  "event_type": "PREFLIGHT_RESULT",
  "preflight_result": "REJECT",
  "rejection_reason_code": "REJ_NETEDGE_BELOW_BUFFER",
  "confidence_level": "MED",
  "net_edge_bps": 1.7,
  "safety_buffer_bps": 3.5,
  "min_profit_wei": 0,
  "max_gas_wei": 0
}
```

**Confidence Levels:**
- `LOW` - Low confidence in edge calculation
- `MED` - Medium confidence
- `HIGH` - High confidence

### 6.3 Canonical Rejection Reason Codes

**Minimum set (extendable, but never rename/remove without migration):**

- `REJ_NETEDGE_BELOW_BUFFER` - Net edge below safety buffer
- `REJ_SLIPPAGE_TOO_HIGH` - Slippage exceeds threshold
- `REJ_GAS_TOO_HIGH` - Gas cost too high
- `REJ_GAS_COVERAGE_RATIO_LOW` - Insufficient gas coverage
- `REJ_STATE_DRIFT_RISK` - State drift risk too high
- `REJ_COMPETITION_DENSITY_HIGH` - Too much competition
- `REJ_SIMULATION_FAILED` - Route simulation failed
- `REJ_BUNDLE_SIM_UNPROFITABLE` - Bundle simulation unprofitable
- `REJ_BUNDLE_SIM_REVERTS` - Bundle simulation reverted
- `REJ_POLICY_FORBIDDEN` - Rejected by policy

---

## 7) Bundle Simulation Results (bundle_sim_results.jsonl)

### 7.1 Required Fields
```json
{
  "schema_version": 1,
  "event_type": "BUNDLE_SIM_RESULT",
  "bundle_id": "bndl_441a...",
  "sim_block_target": 21876544,
  "sim_ok": true,
  "sim_revert": false,
  "sim_revert_reason": null,
  "gross_profit_wei_sim": 42000000000000000,
  "gas_used_wei_sim": 21000000000000000,
  "gas_price_wei_sim": 25000000000,
  "net_profit_wei_sim": 21000000000000000,
  "gas_coverage_ratio": 2.0,
  "decision": "SUBMIT"
}
```

**Decision Values:**
- `REJECT` - Bundle rejected
- `SUBMIT` - Bundle submitted

### 7.2 Error Handling

If `sim_ok` is false, provide:
- `sim_error_code`: str - Error code
- `sim_error_detail`: str - Error details

---

## 8) Submission Results (submission_results.jsonl)

### 8.1 Required Fields
```json
{
  "schema_version": 1,
  "event_type": "SUBMISSION_RESULT",
  "bundle_id": "bndl_441a...",
  "submitted": true,
  "submit_channel": "FLASHBOTS",
  "submit_ok": true,
  "submit_error_code": null,
  "submit_error_detail": null
}
```

**Submit Channels:**
- `FLASHBOTS` - Flashbots relay
- `PRIVATE_RPC` - Private RPC endpoint
- `OTHER` - Other submission method

---

## 9) Inclusion / Outcome Results (inclusion_results.jsonl)

### 9.1 Required Fields
```json
{
  "schema_version": 1,
  "event_type": "INCLUSION_RESULT",
  "bundle_id": "bndl_441a...",
  "target_block": 21876544,
  "included": true,
  "included_tx_hashes": ["0xabc..."],
  "reverted": false,
  "revert_reason": null,
  "gross_profit_wei_real": 41500000000000000,
  "gas_spent_wei_real": 20500000000000000,
  "net_profit_wei_real": 21000000000000000
}
```

---

## 10) **NEW: Telemetry Warning Events (telemetry_warnings.jsonl)**

### 10.1 Purpose

Validation warnings and errors for data quality monitoring.

### 10.2 Required Fields
```json
{
  "schema_version": 1,
  "ts_ms": 1739400002222,
  "run_id": "P24_20260213_abc",
  "event_type": "TELEMETRY_WARNING",
  "severity": "WARN",
  "subsystem": "snapshot_validation",
  "code_namespace": "SNAPSHOT_V1",
  "warning_codes": ["WARN_BUY_NON_MONOTONIC", "WARN_TVL_MISSING"],
  "error_codes": [],
  "ok": true,
  "chain_id": "eth",
  "venue_id": "uniswap_v3",
  "market_id": "0xpool...",
  "block_ref": 21876543,
  "context": {"mid_price": 2684.12}
}
```

### 10.3 Field Definitions

- **`severity`**: "INFO" | "WARN" | "ERROR"
- **`subsystem`**: str - System that emitted warning (e.g., "snapshot_validation", "preflight", "bundle_sim")
- **`code_namespace`**: str - Code category (e.g., "SNAPSHOT_V1", "PREFLIGHT", "BUNDLE")
- **`warning_codes`**: list[str] - Sorted, unique warning codes
- **`error_codes`**: list[str] - Sorted, unique error codes
- **`ok`**: bool - true if data usable despite warnings, false if hard error
- **`context`**: dict | null - Small scalar context (optional)

### 10.4 Severity/Ok Consistency Rules (CANONICAL)

**MUST enforce:**
- If `error_codes` non-empty → `severity` = "ERROR" AND `ok` = false
- Else if `warning_codes` non-empty → `severity` ∈ {"WARN", "INFO"} AND `ok` = true
- At least one code must be present (no empty warning events)

### 10.5 Code Lists Must Be:
- ✅ Lists of strings
- ✅ Sorted (lexicographic)
- ✅ Unique (no duplicates)
- ✅ Non-empty strings only

### 10.6 Canonical Validation Codes

**Snapshot Validation (SNAPSHOT_V1 namespace):**

**Hard Errors (ok=False):**
- `ERR_MIDPRICE_NONPOSITIVE` - Mid price <= 0
- `ERR_MIDPRICE_MISSING` - Mid price field missing

**Warnings (ok=True):**
- `WARN_BUY_LT_MID_TIER_1000` - Buy price < mid at 1k tier
- `WARN_BUY_LT_MID_TIER_5000` - Buy price < mid at 5k tier
- `WARN_BUY_LT_MID_TIER_10000` - Buy price < mid at 10k tier
- `WARN_SELL_GT_MID_TIER_1000` - Sell price > mid at 1k tier
- `WARN_SELL_GT_MID_TIER_5000` - Sell price > mid at 5k tier
- `WARN_SELL_GT_MID_TIER_10000` - Sell price > mid at 10k tier
- `WARN_BUY_NON_MONOTONIC` - Buy prices not monotonically increasing
- `WARN_SELL_NON_MONOTONIC` - Sell prices not monotonically decreasing
- `WARN_SPREAD_NEGATIVE` - Negative spread
- `WARN_SPREAD_ABSURD` - Spread > 5000 bps
- `WARN_SLIPPAGE_NEGATIVE` - Negative slippage
- `WARN_SLIPPAGE_ABSURD` - Slippage > 5000 bps
- `WARN_TVL_MISSING` - TVL data missing
- `WARN_VOLUME_MISSING` - Volume data missing

---

## 11) Derived Metrics (summary_rollups.jsonl)

Daily (or per-run) derived metrics, computed from raw logs:

```json
{
  "schema_version": 1,
  "event_type": "ROLLUP",
  "window": "2026-02-13T00:00Z/2026-02-13T01:00Z",
  "detected_count": 100,
  "preflight_reject_count": 85,
  "preflight_accept_sim_only_count": 10,
  "preflight_accept_bundle_count": 5,
  "simulated_count": 15,
  "submitted_count": 5,
  "included_count": 3,
  "reverted_count": 0,
  "profitable_count": 3,
  "capture_rate": 0.03,
  "bundle_win_rate": 0.60,
  "revert_rate": 0.00,
  "expansion_gate_pass": false,
  "expansion_gate_detail": "capture_rate 3% < 60% required"
}
```

**Rates:**
- `capture_rate`: profitable_count / detected_count
- `bundle_win_rate`: included_count / submitted_count
- `revert_rate`: reverted_count / submitted_count

**Expansion Gate Criteria:**
- Capture rate ≥ 60%
- Revert rate ≤ 10%
- Gas coverage ≥ 1.5x
- Consecutive wins ≥ 30

---

## 12) Contract Tests

All telemetry MUST pass contract tests:

### 12.1 Base Schema Test (`test_schema_minimums.py`)
**Enforces:**
- ✅ `schema_version`: int >= 1
- ✅ `ts_ms`: int > 0
- ✅ `run_id`: str (non-empty)
- ✅ `event_type`: str (non-empty)
- ✅ `duration_ms >= 0` for PIPELINE_STAGE_END events

### 12.2 Warning Schema Test (`test_warning_schema.py`)
**Enforces:**
- ✅ Severity in {"INFO", "WARN", "ERROR"}
- ✅ Codes are sorted, unique lists of strings
- ✅ Severity/ok consistency rules
- ✅ At least one code present (no empty warnings)
- ✅ Context is dict if present

**Location:** `tests/telemetry/`

---

## 13) Example JSONL Lines (Schema v1)

### 13.1 Pipeline Stage Timing
```json
{"schema_version":1,"ts_ms":1739400000000,"run_id":"P24_20260213_ab12cd3","event_type":"PIPELINE_STAGE_BEGIN","opportunity_id":"opp_9f2c...","chain_id":"eth","venue_id":"uniswap_v3","market_id":"0xpool...","route_id":"ETH->USDC_v3_500","notional_usd":1000.0,"block_ref":21876543,"block_target":21876544,"stage":"PREFLIGHT","stage_seq":3,"t_start_ms":1739400000000}
```

```json
{"schema_version":1,"ts_ms":1739400000048,"run_id":"P24_20260213_ab12cd3","event_type":"PIPELINE_STAGE_END","opportunity_id":"opp_9f2c...","chain_id":"eth","venue_id":"uniswap_v3","market_id":"0xpool...","route_id":"ETH->USDC_v3_500","notional_usd":1000.0,"block_ref":21876543,"block_target":21876544,"stage":"PREFLIGHT","stage_seq":3,"t_end_ms":1739400000048,"duration_ms":48}
```

### 13.2 Preflight Result (Reject)
```json
{"schema_version":1,"ts_ms":1739400000050,"run_id":"P24_20260213_ab12cd3","event_type":"PREFLIGHT_RESULT","opportunity_id":"opp_9f2c...","chain_id":"eth","venue_id":"uniswap_v3","market_id":"0xpool...","route_id":"ETH->USDC_v3_500","notional_usd":1000.0,"block_ref":21876543,"block_target":21876544,"preflight_result":"REJECT","rejection_reason_code":"REJ_NETEDGE_BELOW_BUFFER","confidence_level":"MED","net_edge_bps":1.7,"safety_buffer_bps":3.5,"min_profit_wei":0,"max_gas_wei":0}
```

### 13.3 Telemetry Warning (Snapshot Validation)
```json
{"schema_version":1,"ts_ms":1739400002222,"run_id":"P24_20260213_ab12cd3","event_type":"TELEMETRY_WARNING","severity":"WARN","subsystem":"snapshot_validation","code_namespace":"SNAPSHOT_V1","warning_codes":["WARN_BUY_NON_MONOTONIC","WARN_TVL_MISSING"],"error_codes":[],"ok":true,"chain_id":"eth","venue_id":"uniswap_v3","market_id":"0xpool...","block_ref":21876543,"context":{"mid_price":2684.12}}
```

### 13.4 Bundle Simulation Result (Submit)
```json
{"schema_version":1,"ts_ms":1739400001120,"run_id":"P24_20260213_ab12cd3","event_type":"BUNDLE_SIM_RESULT","opportunity_id":"opp_a13e...","chain_id":"eth","venue_id":"uniswap_v3","market_id":"0xpool...","route_id":"ETH->USDC_v3_500","notional_usd":1000.0,"block_ref":21876543,"block_target":21876544,"bundle_id":"bndl_441a...","sim_block_target":21876544,"sim_ok":true,"sim_revert":false,"sim_revert_reason":null,"gross_profit_wei_sim":42000000000000000,"gas_used_wei_sim":21000000000000000,"gas_price_wei_sim":25000000000,"net_profit_wei_sim":21000000000000000,"gas_coverage_ratio":2.0,"decision":"SUBMIT"}
```

---

## 14) Migration Guide (v0 → v1)

**Legacy telemetry (no schema_version):**
- Treat as schema v0
- Analytics should default to v1 behavior when `schema_version` missing
- Do not rewrite legacy files (preserve history)
- Quarantine legacy files in `data/telemetry_legacy/` (gitignored)

**Forward compatibility:**
- Unknown fields → ignore (don't crash)
- Unknown event types → log warning, skip
- Future schema versions → support side-by-side

---

## 15) Governance Summary

**Required Fields (ALL events):**
1. `schema_version` (int >= 1)
2. `ts_ms` (int > 0)
3. `run_id` (str, non-empty)
4. `event_type` (str, non-empty)
5. Identity fields (chain_id, venue_id, market_id, etc.)

**Versioning Policy:**
- Additive changes OK within version
- Breaking changes require version bump
- Analytics must support multiple versions

**Validation:**
- Contract tests enforce schema compliance
- TELEMETRY_WARNING events for data quality
- No silent failures (explicit codes required)

**Storage:**
- Append-only JSONL (deterministic)
- No database required (JSONL is canonical)
- Legacy files quarantined, not deleted

---

**END OF DOCUMENT**

**Version:** 1.1 (2026-02-18)  
**Status:** CANONICAL  
**Next Review:** Phase 2.4.1 completion
