# PHASE 2.4.2 — ROUTE SIMULATOR SPEC (STATE-MODEL BOUNDED)

Status: DRAFT → IMPLEMENT
Phase: 2.4.2
Depends On: Phase 2.4.0 (telemetry+validation), Phase 2.4.1 (preflight)
Governance: Determinism-first, JSONL canonical, no hidden state, replay-safe.

## 0. Purpose

The Route Simulator is the deterministic “expensive math” layer that simulates a candidate execution route under an explicit, bounded state model (block_ref).

It answers:
- “What would actually happen if we execute this route at block_ref state?”
- “What is the expected net result after fees + bounded gas?”
- “Is the outcome robust to bounded drift (safety buffer)?”

It must NOT:
- perform network I/O
- query RPCs
- mutate shared state
- depend on wall-clock timing
- embed strategy decisions beyond deterministic simulation rules

---

## 1. Inputs

Route simulation operates on:

### 1.1 Route Definition
A route is a sequence of legs.

- `RouteLeg` (one step)
  - `dex_type`: `V2_AMM | V3_AMM | ORDERBOOK` (orderbook later; V2+V3 first)
  - `venue_id`
  - `pool_id` (address or canonical ID)
  - `token_in` (address)
  - `token_out` (address)
  - `fee_bps` (or fee tier identifier)

- `Route`
  - `route_id`
  - `chain_id`
  - `legs: List[RouteLeg]`

### 1.2 Simulation Context
- `block_ref: int` (explicit)
- `tier_usd: int` in `{1000, 5000, 10000}` (or explicit notional input)
- `notional_in`: amount in token_in units OR USD tier translated upstream
- `gas_model: GasModelV1` (bounded deterministic estimate)
- `policy: SimulationPolicyV1` (buffers, caps)

### 1.3 Pool State (Canonical)
Simulation requires pool state at `block_ref` for every leg.

Pool state MUST be provided as input (cached snapshot), never fetched live.

- V2 pool state (minimum)
  - `token0`, `token1`
  - `reserve0`, `reserve1` (raw ints)
  - `fee_bps`
  - optional: `block_ref` as metadata

- V3 pool state (minimum for approximation)
  - `token0`, `token1`
  - `fee_tier` (bps)
  - `sqrtPriceX96`
  - `tick`
  - `liquidity`
  - optional: `block_ref`

- V3 pool state (exact tick-walk)
  - everything above, plus
  - initialized tick data (tick table) sufficient to walk price ranges
  - tick spacing / bitmap representation (cached)

If any required pool state is missing → deterministic failure code.

---

## 2. Outputs

### 2.1 SimResult
`SimResult` MUST be fully deterministic from inputs:

- `ok: bool`
- `reason_code: Optional[str]` (canonical)
- `block_ref: int`
- `route_id: str`
- `amount_in: int/float` (token units; deterministic representation)
- `amount_out: int/float`
- `gross_edge_bps: float`
- `fee_bps_total: float`
- `gas_cost_usd_est: float`
- `gas_bps_est: float`
- `net_edge_bps: float`
- `slippage_bps_realized: float` (if derivable)
- `price_impact_bps: float` (if derivable)
- `notes: Optional[str]`

### 2.2 Telemetry
Emit `ROUTE_SIM_RESULT` event (schema_version=1), append-only JSONL.

Required telemetry fields:
- identity: `ts_ms`, `run_id`, `opportunity_id`, `chain_id`, `venue_id`, `market_id`, `route_id`, `notional_usd`, `block_ref`, optional `block_target`
- payload: `ok`, `reason_code`, `net_edge_bps`, `gas_bps_est`, `slippage_bps_realized`, `amount_in`, `amount_out`

Namespace suggestion:
- `data/telemetry/YYYYMMDD/route_sim_results.jsonl`

---

## 3. Determinism Rules (Non-Negotiable)

1) No RPC calls, no mempool reads, no network I/O inside simulation.
2) All state is explicit: route + pool_state + params.
3) Stable floating math policy:
   - Prefer integer math where feasible (esp. V2 reserves).
   - If floats are used, round at fixed precision and serialize deterministically.
4) Stable rejection/failure codes and ordering.
5) Missing state yields deterministic failure.

---

## 4. Canonical Failure / Reject Codes (Simulation Layer)

Simulation may produce “simulation-level rejects” distinct from preflight.

Minimum codes (additive only):
- `SIM_MISSING_POOL_STATE`
- `SIM_BAD_TOKEN_ORDER`
- `SIM_NONPOSITIVE_INPUT`
- `SIM_NUMERIC_OVERFLOW`
- `SIM_UNSUPPORTED_DEX_TYPE`
- `SIM_V3_TICKDATA_MISSING` (when exact mode requested)
- `SIM_V3_QUOTE_FAILED`

These are NOT preflight rejection codes; they are simulation failure codes.

---

## 5. Implementation Phases

## 5.1 Phase 2.4.2A — Core Interfaces
Deliver:
- types: `RouteLeg`, `Route`, `SimContext`, `SimResult`
- engine entrypoint: `simulate_route(route, pool_state_map, ctx) -> SimResult`
- deterministic failure behavior

## 5.2 Phase 2.4.2B — V2 AMM Simulation (Fast Win)
Support constant-product pools (UniswapV2/Sushi).

Given:
- reserves (token0/token1)
- fee_bps

Compute:
- amount_out using x*y=k with fee adjustment
- multi-leg composition by feeding output of leg i as input to leg i+1

Math (conceptual):
- amount_in_after_fee = amount_in * (1 - fee)
- amount_out = (amount_in_after_fee * reserve_out) / (reserve_in + amount_in_after_fee)

Emit:
- realized price impact and slippage proxies where possible

## 5.3 Phase 2.4.2C — V3 AMM Simulation (Required)

### 5.3.1 C1: Bounded Approximation (Early Acceptable)
Use slot0 + liquidity to approximate quote deterministically.
No tick walking; fast and bounded.
If approximation cannot be computed deterministically → `SIM_V3_QUOTE_FAILED`.

### 5.3.2 C2: Exact Tick-Walk (Target)
Walk initialized ticks, consuming liquidity across price ranges.
Requires cached tick table for pool at block_ref.
If tick data missing → `SIM_V3_TICKDATA_MISSING`.

---

## 6. Gas Model (Bounded, Deterministic)

Simulator MUST use a deterministic gas estimate:
- `gas_cost_usd_est = gas_model.estimate_usd(chain_id, route, tier_usd)`
- `gas_bps_est = (gas_cost_usd_est / tier_usd) * 10000`

No live gas oracle inside simulation.

---

## 7. Safety Buffer Integration

Simulator should compute:
- `net_edge_bps = gross_edge_bps - fee_bps_total - gas_bps_est`

Safety buffer comparison is owned by 2.4.1 Preflight, but simulator MUST output enough data to support:
- `net_edge_bps`
- `slippage_bps_realized`
- `price_impact_bps`

---

## 8. Tests (Required)

1) Determinism:
- identical inputs → identical SimResult

2) V2 single-leg:
- known reserves → expected out amount

3) V2 multi-leg:
- composition stable and monotonic

4) Failure modes:
- missing pool state returns `SIM_MISSING_POOL_STATE`
- unsupported dex_type returns `SIM_UNSUPPORTED_DEX_TYPE`

5) V3 (when implemented):
- approximation returns stable results for fixed slot0/liquidity inputs
- exact mode requires tick data and fails deterministically if missing

---

## 9. Done Criteria (Phase 2.4.2 “Core Done”)

Minimum completion (2.4.2B):
- Core interfaces exist
- V2 simulator works with tests passing
- ROUTE_SIM_RESULT telemetry emitted
- Deterministic failure codes enforced

Next completion (2.4.2C):
- V3 approximation implemented + tests
- Exact tick-walk planned/started with deterministic tick-cache input format
