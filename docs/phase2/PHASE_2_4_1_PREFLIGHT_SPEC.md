# PHASE 2.4.1 — PREFLIGHT MODULE SPEC (DETERMINISTIC)

Status: DRAFT → IMPLEMENT
Phase: 2.4.1
Governance: JSONL canonical, determinism-first, telemetry contract enforced.

## 0. Purpose

Preflight is the *cheap deterministic gate* that rejects the majority of opportunities **before** any costly simulation / bundling steps.

**Preflight must be pure and deterministic**:
- same inputs → same outputs
- no hidden state
- no network I/O
- stable rejection ordering (taxonomy)

Preflight outputs must be telemetry-friendly and measurable.

---

## 1. Inputs

Preflight operates on validated `MarketSnapshotV1` objects.

### 1.1 Required
- `snapshot_buy: MarketSnapshotV1` (venue where we would buy)
- `snapshot_sell: MarketSnapshotV1` (venue where we would sell)
- `tier_usd: int` in `{1000, 5000, 10000}`
- `policy: PreflightPolicyV1` (thresholds + safety buffer params)
- `gas_model: GasModelV1` (bounded estimate; deterministic)

### 1.2 Optional (if available in snapshot)
- `competition_density` (0..1)
- `auth_score` (0..10)
- `latency_ms_est`
- `snapshot_age_ms` or equivalent (if derived)

---

## 2. Outputs

### 2.1 Return Value
`PreflightDecision`:
- `result`: `REJECT | ACCEPT_SIM_ONLY | ACCEPT_BUNDLE`
- `rejection_reason_code`: canonical code or `None`
- `net_edge_bps`: float
- `safety_buffer_bps`: float
- `confidence_level`: `LOW | MED | HIGH`
- `min_profit_wei`: int (placeholder allowed at 2.4.1)
- `max_gas_wei`: int (placeholder allowed at 2.4.1)

### 2.2 Telemetry
Always emit a `PreflightResultEvent` (schema_version=1) with:
- `preflight_result`
- `rejection_reason_code`
- `confidence_level`
- `net_edge_bps`
- `safety_buffer_bps`
- `min_profit_wei`
- `max_gas_wei`

---

## 3. Canonical Rejection Taxonomy (Deterministic Order)

The preflight function MUST evaluate and reject using the first matching rule in this exact order:

1) `REJ_POLICY_FORBIDDEN`
   - denylisted token/venue/market
   - tier not permitted
   - any explicit operator policy

2) `REJ_SIMULATION_FAILED`
   - missing required tier fields
   - mismatched chain_id
   - mismatched token pair between buy/sell snapshots
   - non-positive mid reference
   - any undefined/NaN critical numeric

3) `REJ_SLIPPAGE_TOO_HIGH`
   - tier slippage exceeds cap (policy)

4) `REJ_GAS_TOO_HIGH`
   - estimated gas bps exceeds cap (policy)

5) `REJ_GAS_COVERAGE_RATIO_LOW` (optional placeholder until 2.4.3)
   - reserved for bundle-level checks later

6) `REJ_NETEDGE_BELOW_BUFFER`
   - net_edge_bps <= safety_buffer_bps

7) `REJ_STATE_DRIFT_RISK`
   - bounded drift risk too high (policy; uses latency/age proxy)

8) `REJ_COMPETITION_DENSITY_HIGH`
   - competition density exceeds cap (policy)

Note: If multiple conditions are true, the earliest rule wins to ensure stable analytics.

---

## 4. Tier Selection Rules

For `tier_usd` select tiered fields from both snapshots:

Tier 1000:
- buy_px = `buy_px_1k`
- sell_px = `sell_px_1k`
- slip_bps = `slippage_bps_1k`

Tier 5000:
- buy_px = `buy_px_5k`
- sell_px = `sell_px_5k`
- slip_bps = `slippage_bps_5k`

Tier 10000:
- buy_px = `buy_px_10k`
- sell_px = `sell_px_10k`
- slip_bps = `slippage_bps_10k`

If required tier fields are missing → `REJ_SIMULATION_FAILED`.

---

## 5. Net Edge Calculation (MVP, Deterministic)

### 5.1 Reference Mid
Use a stable reference mid:
- `mid_ref = (snapshot_buy.mid_px + snapshot_sell.mid_px) / 2`

If `mid_ref <= 0` → `REJ_SIMULATION_FAILED`.

### 5.2 Gross Edge (bps)
- `gross_edge_bps = ((sell_px - buy_px) / mid_ref) * 10000`

### 5.3 Costs (bps)
Fees:
- `fee_bps = snapshot_buy.swap_fee_bps + snapshot_sell.swap_fee_bps`

Gas (bounded estimate):
- `gas_cost_usd_est = gas_model.estimate_usd(chain_id=..., venue_id=..., tier_usd=tier_usd)`
- `gas_bps = (gas_cost_usd_est / tier_usd) * 10000`

### 5.4 Net Edge (bps)
- `net_edge_bps = gross_edge_bps - fee_bps - gas_bps`

Important: Do NOT subtract slippage again if the tiered prices are effective execution prices.

---

## 6. Safety Buffer (State-Model Bounded)

Safety buffer is a conservative margin for:
- minor state drift between block_ref and target
- gas variance
- latency skew
- competition risk

MVP formula:
safety_buffer_bps =
base_buffer_bps

k_slippage * max(slippage_buy_bps, slippage_sell_bps)

k_latency * (latency_ms_est / 1000)

k_competition * competition_density

Defaults may start conservative and be tuned later.

Decision rule:
- if `net_edge_bps <= safety_buffer_bps` → `REJ_NETEDGE_BELOW_BUFFER`

---

## 7. Accept Levels (SIM_ONLY vs BUNDLE)

Preflight may classify “bundle-ready” even before full 2.4.3:
- `ACCEPT_BUNDLE` if:
  - `net_edge_bps >= safety_buffer_bps + bundle_extra_bps`
  - and confidence is HIGH (stable proxies)
- else if `net_edge_bps > safety_buffer_bps`:
  - `ACCEPT_SIM_ONLY`
- else:
  - `REJECT`

Confidence heuristic (deterministic):
- HIGH if net edge has meaningful margin above buffer and slippage low.
- MED default.
- LOW if near-threshold.

---

## 8. Tests (Required)

1) Determinism:
- identical inputs produce identical outputs

2) Rejection ordering:
- when multiple conditions true, earliest rule wins

3) Tier selection:
- 1k/5k/10k selects correct fields and changes outcome

---

## 9. Done Criteria (Phase 2.4.1 Complete)

- Preflight implemented as pure function
- Preflight telemetry emitted for every evaluation
- Unit tests passing
- Metrics analyzer can compute:
  - accept/reject rates
  - rejection breakdown (codes)
  - edge distribution (net edge vs buffer)
