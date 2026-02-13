

```
docs/phase2/PHASE_2_3A_MARKET_INEFFICIENCY_PROFILER_PLAN.md
```

It reflects the refined, disciplined build strategy and aligns with your architecture and governance approach.

---

# PHASE 2.3A — MARKET INEFFICIENCY PROFILER

**Status:** ACTIVE BUILD
**Purpose:** Foundational Validation Before Multi-Chain Expansion
**Authority:** Phase-0 Governance Applies

---

# 1. Executive Objective

Phase 2.3A exists to answer one critical question:

> Does measurable, persistent, executable edge exist in our current 14 markets?

Expansion to 150+ markets is forbidden until this phase produces quantified proof of exploitable inefficiency.

This phase builds the structural measurement layer that all future chain and DEX integrations depend on.

No expansion occurs without profiler confirmation.

---

# 2. Core Principle

Maximum edge-per-integration-cost.

Not maximum opportunity count.
Not maximum market coverage.
Not theoretical spreads.

Edge must be:

* Measurable
* Persistent
* Size-survivable
* Executable within latency constraints
* Positive after full cost modeling

If the current stack cannot extract repeatable positive NetEdge from 14 markets, adding 150 markets only multiplies noise.

---

# 3. Build Components

Phase 2.3A consists of four modules:

1. Canonical `MarketSnapshot` Schema
2. Market Inefficiency Profiler
3. Volume Authenticity Scorer
4. Minimal Universe Registry

All modules must comply with deterministic serialization and replay discipline.

---

# 4. Canonical MarketSnapshot (v1)

## Purpose

Provide a normalized, deterministic representation of any market at a given timestamp.

All scoring, filtering, and risk modeling must consume this object exclusively.

No adapter-specific logic may bypass it.

---

## Required Fields

### Identity

* `ts_ms`
* `chain_id`
* `venue_id`
* `market_id`
* `market_type`
* `base_token`
* `quote_token`

### Pricing

* `mid_px`
* Tiered effective prices:

  * `buy_px[1k]`
  * `sell_px[1k]`
  * `buy_px[5k]`
  * `sell_px[5k]`
  * `buy_px[10k]`
  * `sell_px[10k]`
* `spread_bps_1k`
* `slippage_bps[tier]`

### Liquidity

* `depth_usd_1pct`
* `tvl_usd`
* `volume_usd_24h`

### Costs

* `swap_fee_bps`
* `gas_cost_usd`
* `latency_ms_est`

### Quality & Competition

* `auth_score`
* `recent_tx_count_60s`
* `competition_density`

---

## Invariants

* Tier sizes must be strictly increasing.
* Effective prices must include fee + slippage.
* No negative prices.
* Deterministic serialization required.
* No implicit defaults allowed.
* Missing data must be explicit, not inferred.

---

# 5. Market Inefficiency Profiler

## Purpose

Quantify structural inefficiency across existing markets.

Not volatility. Not price movement.

Inefficiency.

---

## Metrics Computed

* Average spread (bps)
* 95th percentile spread
* Spread persistence (ms)
* Mispricing half-life
* Slippage survivability at 1k / 5k / 10k
* Realized vs quoted slippage delta
* Edge decay rate
* Competition response time
* NetEdge distribution

---

## NetEdge Formula

```
NetEdge =
    SpreadBenefit
  - SlippageCost
  - SwapFees
  - GasCost
  - ExecutionLatencyPenalty
  - FailureRiskPenalty
  - CompetitionPenalty
```

If NetEdge <= SafetyBuffer:
Reject opportunity.

---

## Output Format

Example:

```
Market           AvgSpread  95pSpread  Persist_ms  Slippage@5k  EdgeScore  Status
-----------------------------------------------------------------------------------
Uni ETH/USDC       22bps      45bps       850ms      -18bps       4.2     WEAK
Sushi ETH/USDC     25bps      52bps      1200ms      -20bps       5.1     VIABLE
Cross-DEX ETH      61bps     120bps      2100ms      -25bps      11.3     STRONG
```

---

# 6. Volume Authenticity Scorer

Purpose: Prevent fake volume from polluting edge detection.

---

## Metrics

* Wallet diversity ratio
* Trade size variance ratio
* Inter-trade entropy
* Liquidity depth coefficient of variation

---

## Fake Volume Indicators

* Repeating identical trade sizes
* Perfect periodic trade intervals
* Extremely low wallet diversity
* Artificially stable depth

---

## Output Example

```
Token   WalletDiv  SizeVar  TimeEntropy  DepthStability  AuthScore  Status
-----------------------------------------------------------------------------
ETH      0.89       2.4       0.91         0.15           9.2      REAL
XYZ      0.12       0.3       0.15         0.89           1.8      FAKE
```

Markets below minimum authenticity threshold remain scan-only.

---

# 7. Universe Registry (Minimal)

Purpose: Enable future multi-chain expansion without premature complexity.

---

## Schema

### Chain

* chain_id
* rpc_url
* gas_model
* execution_status (SCAN_ONLY | EXECUTION_ENABLED)

### Venue

* venue_id
* chain_id
* dex_type
* flash_loan_capable

### Token

* address
* symbol
* decimals
* authenticity_score
* blacklisted

---

## Scope Limitation

* No bridge logic in Phase 2.3A.
* No cross-chain execution.
* No flash loan integration yet.
* Registry supports scan-only mode by default.

---

# 8. Execution Discipline

All chains start as:

SCAN_ONLY

Promotion to EXECUTION_ENABLED requires:

* Verified NetEdge distribution above threshold
* Persistence > latency
* Failure rate within tolerance
* Slippage model accuracy within bounds

No exceptions.

---

# 9. Data Storage

Snapshots stored as append-only JSONL:

```
data/snapshots/{chain}/{venue}/{market_id}/YYYYMMDD.jsonl
```

Rules:

* Stable key ordering
* No mutation of historical entries
* Deterministic formatting
* Replay-safe

---

# 10. Phase Completion Criteria

Phase 2.3A is complete when:

* MarketSnapshot v1 supports all 14 current markets
* Profiler produces statistical report after 1–2 hours of live data
* Authenticity scoring filters low-quality markets
* Edge distribution analysis is generated
* Clear recommendation exists:

  * Expand
  * Refocus
  * Abort expansion

---

# 11. Possible Outcomes

## Strong Edge

Proceed to Phase 2.3B (Base → Arbitrum → Avalanche).

## Weak Edge

Pause expansion.
Improve execution layer.
Refine filtering.

## Mixed

Expand only proven strategy types.
Drop ineffective ones.

---

# 12. Strategic Insight

Expansion is conditional.

Edge must be demonstrated before scale.

This phase transforms the system from speculative expansion to data-driven structural growth.

No ego deployments.
No hope-driven integrations.
No noise multiplication.

Measured growth only.

---

# 13. Next Phase Preview

Phase 2.3B — EVM L2 Expansion
(Triggered only after profiler confirmation)

Target order:

1. Base
2. Arbitrum
3. Avalanche

All chains begin in SCAN_ONLY probation.

---

**End of Phase 2.3A Build Plan**
