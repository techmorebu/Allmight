
Status: DRAFT → READY FOR IMPLEMENTATION
Scope: Phase 2.4 (Execution Hardening)
Authority: Phase-0 Governance (Determinism + Replay Safety)

---

## 1) Context

Phase 2.3A Market Inefficiency Profiler results indicate:
- 14 markets analyzed
- 8 markets show VIABLE edge (4.0–8.0)
- 6 markets show WEAK edge (1.0–4.0)
- 0 markets show STRONG edge (≥8.0)
- “0ms persistence” observed (may be real or a measurement artifact)

Interpretation:
Edge exists, but it is likely fleeting and/or extremely sensitive to state drift, fees, and execution latency.
Expanding markets now would amplify noise unless execution is hardened first.

---

## 2) Objective

Build a deterministic, state-model bounded execution pipeline that can:
- Reject >90% of detected opportunities deterministically
- Execute only opportunities that remain profitable under an explicit block-state model + safety buffers
- Submit privately (no public mempool)
- Produce auditable receipts and metrics for capture rate and failure analysis
- Define a strict expansion gate for Phase 2.3B (Base/Arbitrum)

This is NOT a “speed-first” phase.
This is a determinism-first, correctness-first, measurement-first phase.

---

## 3) In-Scope

Phase 2.4 delivers:
- 2.4.0 Instrumentation (latency + outcome telemetry; rejection taxonomy)
- 2.4.1 Execution Preflight module (deterministic accept/reject contract)
- 2.4.2 Deterministic route simulator (block-state bounded)
- 2.4.3 Gas + bundle simulator (Flashbots sim / equivalent)
- 2.4.4 FlashLoanExecutor.sol (minimal, stateless contract)
- 2.4.5 Private execution layer (Flashbots / private RPC submission)
- 2.4.6 Capture rate tracker (metrics + expansion gate evaluation)

---

## 4) Explicitly Out-of-Scope (Forbidden in Phase 2.4)

- Market expansion (Base/Arbitrum/Avalanche/etc.)
- Cross-chain execution and bridging
- Strategy proliferation (triangle, depeg, etc.) beyond current viable set
- “Speed hacks” without instrumentation proof
- Any claim of “guaranteed profit” independent of state modeling

---

## 5) Key Definitions

### 5.1 State-Model Bounded Profitability
Profitability claims must always be tied to:
- A specific reference block state N
- A targeted inclusion block N+1 (or a defined window)
- A safety buffer that accounts for:
  - small state drift
  - fee variance
  - partial competition effects
  - latency skew

We do not claim “guaranteed profit”.
We claim: “Profitable under explicit state model with defined buffers.”

### 5.2 NetEdge (canonical)
NetEdge is computed per route per notional tier:

NetEdge =
  SpreadBenefit
- SlippageCost
- SwapFees
- GasCost
- ExecutionCost (latency/risk premium)
- FailureRiskPenalty
- CompetitionPenalty
- SafetyBuffer

If NetEdge <= 0 (or <= SafetyBufferThreshold), reject.

---

## 6) Build Order (Mandatory)

### 6.1 Phase 2.4.0 — Latency & Outcome Instrumentation (FIRST)
Purpose:
Measure end-to-end timing and failure/rejection causes before optimizing anything.

Instrument:
- Snapshot fetch time
- Normalization time
- Preflight time
- Simulation time
- Bundle build time
- Bundle sim time
- Submission time
- Inclusion/confirmation time

Also record:
- rejection reason codes (taxonomy)
- revert reasons (if on-chain)
- bundle inclusion/loss outcomes
- state drift magnitude N → N+1 (where measurable)

Deliverable:
- A baseline latency table and failure histogram for the current 14 markets.

---

### 6.2 Phase 2.4.1 — Execution Preflight Module
Purpose:
Deterministic accept/reject filter that operationalizes “>90% rejection is good”.

Interface (conceptual):

preflight_check(
  snapshot, route, block_ref,
  notional, safety_policy
) -> PreflightResult

PreflightResult:
- REJECT
- ACCEPT_SIM_ONLY
- ACCEPT_BUNDLE

Outputs (always logged):
- net_edge_bps
- min_profit_wei
- max_gas_wei
- rejection_reason_code
- confidence_level (based on state stability + slippage convexity)

Preflight must be deterministic given the same inputs.

---

### 6.3 Phase 2.4.2 — Deterministic Route Simulator (Block-State Bounded)
Purpose:
Simulate the route against a specific block state N and compute expected profitability
for a targeted block N+1, including buffers.

Capabilities:
- Uniswap V3 tick-level slippage estimation (where applicable)
- Uniswap V2 reserve-based impact estimation (where applicable)
- Multi-hop route evaluation
- Fee accounting (swap fees + flash loan premium if applicable)
- Gas cost estimate (base + priority; model per chain)
- Safety buffer application

Required property:
Simulation input must be anchored to block N state (not “latest”).

---

### 6.4 Phase 2.4.3 — Gas Model & Bundle Simulator
Purpose:
Validate bundles before submission and estimate win probability / cost viability.

Workflow:
1) Build bundle for block N+1
2) Simulate bundle using Flashbots simulation endpoint (or equivalent)
3) Compute:
   - simulated profit if included
   - gas used and coverage ratio
   - failure/revert likelihood
4) Reject unless:
   - gas coverage ratio >= 1.5x
   - profit >= min_profit_wei (buffered)
   - revert probability within tolerance

---

### 6.5 Phase 2.4.4 — FlashLoanExecutor.sol (Minimal, Stateless)
Purpose:
Atomic execution component used by bundles.

Design principles:
- No routing logic in contract
- Stateless execution: same inputs => same behavior
- Revert if profit < minProfit
- Emit receipt events (route hash, profit, gas, tokens)

Note:
This is step 4, not step 1.

---

### 6.6 Phase 2.4.5 — Private Execution Layer (No Public Mempool)
Purpose:
MEV protection and execution reliability.

Requirements:
- Private submission path only
- Bundle simulation before submission
- Block targeting support (N+1)
- No “send to public mempool” fallback

---

### 6.7 Phase 2.4.6 — Capture Rate Tracker
Purpose:
Measure execution quality and enforce expansion gate.

Log fields per opportunity:
- detected_ts
- preflight_result
- rejection_reason_code
- simulated (bool)
- submitted (bool)
- included (bool)
- reverted (bool)
- profitable (bool)
- net_profit_wei
- gas_spent_wei
- block_ref (N)
- block_target (N+1)

Derived metrics:
- CaptureRate = profitable / detected
- BundleWinRate = included / submitted
- RevertRate = reverted / submitted
- ExecutionLossRate = gas_lost / gross_profit
- DriftLossRate = profitable_at_N_but_not_at_N_plus_1 / simulated

---

## 7) Rejection Taxonomy (Reason Codes)

All rejects MUST have a reason code.

Minimum codes:
- REJ_NETEDGE_BELOW_BUFFER
- REJ_SLIPPAGE_TOO_HIGH
- REJ_GAS_TOO_HIGH
- REJ_GAS_COVERAGE_RATIO_LOW
- REJ_STATE_DRIFT_RISK
- REJ_COMPETITION_DENSITY_HIGH
- REJ_SIMULATION_FAILED
- REJ_BUNDLE_SIM_UNPROFITABLE
- REJ_BUNDLE_SIM_REVERTS
- REJ_POLICY_FORBIDDEN (out-of-scope venue/token)

---

## 8) Expansion Gate (Non-Negotiable)

Expansion to Phase 2.3B (Base/Arbitrum) is allowed only if ALL are true:

- CaptureRate >= 0.60
- RevertRate <= 0.10
- GasCoverageRatio >= 1.5
- ConsecutiveProfitable >= 30 (same strategy class / narrow market set)

If gate fails:
Do not expand. Improve execution hardening until it passes.

---

## 9) Validation Evidence Required

Phase 2.4 is not “done” without proof artifacts:

Required evidence:
- Latency baseline report (Phase 2.4.0)
- Rejection histogram (counts per reason code)
- Bundle simulation outcomes (profit/lose distributions)
- CaptureRate, BundleWinRate, RevertRate time series
- Replay steps: run same inputs -> same decision -> same logged outputs (determinism)

---

## 10) Implementation Notes (Design Constraints)

- Keep battlefield narrow: focus on the existing viable set (no strategy sprawl).
- Prefer correctness and rejection over “more trades”.
- Contracts must remain minimal; routing intelligence stays off-chain.
- Every step must log enough to explain outcomes post-mortem.

---

## 11) Phase Handoff Contract (to Phase 2.3B)

If Phase 2.4 gate passes, Phase 2.3B may assume:
- A stable preflight + simulation pipeline exists
- Private bundle submission exists
- Capture metrics exist and are trustworthy
- Expanding markets will not break determinism contracts

Phase 2.3B is forbidden from:
- Introducing new chains without scan-only probation
- Enabling public mempool submission
- Relaxing expansion gates without documented justification
