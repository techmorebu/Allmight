# Phase 2A.2 — Arbitrum DAI/USDC Inventory Hypothesis: REJECTED

| Field | Value |
|---|---|
| **Surface** | `arbitrum:DAI/USDC:uni_camelot` |
| **Status** | `REJECTED` |
| **Rejection type** | `STRUCTURALLY_DEAD` |
| **Reason** | `INSUFFICIENT_SPREAD_AMPLITUDE` |
| **Boss verdict** | 2026-05-30 |
| **Phase** | 2A.2 (Inventory research branch) |

> The important outcome is not that DAI/USDC failed. The important outcome is that the system successfully converted a plausible hypothesis into a measured verdict.  
> — Boss, 2026-05-30

---

## 1. The hypothesis (pre-test)

Following the Phase 2B inventory-mode scorer (`scripts/tools/surface_score_inventory.js`, commit `37d298a`), this surface appeared to be a frontier candidate:

| Component | Value |
|---|---|
| Per-trade inventory breakeven (no Aave) | **2.7 bp** |
| Single-snapshot observed dislocation | ~2.0 bp |
| Gap to viability | **+0.7 bp** |

That gap was small enough to motivate Phase 2A.2 telemetry: *"Where can inventory-style dislocations actually survive — and how often does this surface clear 2.7 bp and persist long enough to be capturable?"*

## 2. The experiment

- **Acquisition layer:** `scripts/research/dai_usdc_arb_collector.js` — READ-ONLY observational, same-block anchored, config-driven, `withTimeout` Redis reads. Acquisition only; no thresholds, no interpretation.
- **Interpretation layer:** `scripts/research/dai_usdc_behavioral_report.js` — SEPARATE script reading the collector's jsonl; distribution / frequency / persistence / descriptive hint.
- **Constitutional separation** between layers preserved throughout (Boss Phase 2A.2 ruling).
- **Window:** started 2026-05-28 22:10 CT. Planned 12h, recorded 8.49h (master-fetcher cron stopped at hour ~8.5; collector logged misses for the remainder until graceful duration deadline).
- **Effective sample cadence:** ~27 seconds per fetcher refresh.

## 3. The result

```
samples            1,011  (100% same-block — zero cross-block contamination)
window             2026-05-28 22:10 CT → 2026-05-29 06:40 CT  (8.49 hours)
distribution (bp)  min 0.23 | P50 0.34 | P75 0.35 | P90 0.43 | P95 0.43 | max 0.47 | mean 0.34
threshold crossings  ≥ 2.7 bp: 0    ≥ 3.0: 0    ≥ 4.0: 0    ≥ 5.0: 0
descriptive hint   STRUCTURALLY_DEAD — NO observations ≥ 2.7 bp in the sample window
```

```
observed maximum:        0.47 bp
inventory floor:         2.70 bp
shortfall at maximum:    2.23 bp   ← structural separation, not a near miss
```

## 4. Boss verdict (2026-05-30)

> The market is behaving exactly as we would expect from a highly arbitraged stablecoin pair with concentrated liquidity and mature competition.

```
SURFACE_STATUS = REJECTED
REJECTION_TYPE = STRUCTURALLY_DEAD
REASON         = INSUFFICIENT_SPREAD_AMPLITUDE
```

## 5. Caveats (preserved for honesty and auditability)

1. **Cadence resolution.** Effective fetcher cadence ~27 s → spikes resolving in less than ~27 s are systematically invisible. Inventory arb requires seconds to sign+broadcast, so the visible regime is also the *capturable* regime — this is not believed to bias the verdict.
2. **Time-of-day.** Window covered late US evening → overnight → Asia trading → early European open. It did NOT cover US business hours. Given the observed maximum (0.47 bp) sits ~5.7× below the floor (2.7 bp), a daytime amplification factor would need to be implausibly large to flip the result.
3. **Truncated run.** Master-fetcher cron stopped writing Redis at approximately hour 8.5; collector ran out its duration deadline thereafter recording misses. Sample count (1,011) remains overwhelmingly sufficient.
4. **One surface, one venue pair.** The verdict applies to `arbitrum:DAI/USDC:uni_camelot` specifically.

## 6. What this forecloses, and what it doesn't

**Forecloses (with confidence):**
- `arbitrum:DAI/USDC:uni_camelot` as an inventory-arb candidate at current spread distribution.

**Does not foreclose:**
- The broader inventory thesis (this is one surface; the result is local).
- Stable inventory candidates with *materially different* fee geometry (e.g., 5bp ↔ 30bp venue mismatches; newer DEX deployments; fragmented stable routes).
- Same-pair candidates on different chains (lower priority — the lesson likely portable).
- **Non-stable inventory candidates** (ETH/USDC, ETH/USDT, WBTC/USDC, WBTC/USDT) where directional flow + volatility produce larger temporary dislocations. (Boss flagged this as the most interesting direction.)
- The flash-loan scorer (separate model, untouched).

## 7. Architectural lessons (preserved)

- The acquisition / interpretation separation worked exactly as designed — the collector recorded raw observations with no thresholds or verdicts; the analyzer applied them later. Boss's "constitutional separation" principle proved its value here.
- The system successfully converted a *plausible hypothesis* (per-snapshot 0.7 bp gap → maybe viable) into a *measured verdict* (8.5 h reality → 2.23 bp gap, structurally separated).
- The flash-loan scorer and inventory-mode scorer remained physically separate throughout — `MODEL = INVENTORY` and `NOT COMPARABLE TO FLASH SCORE` labels held; no metric contamination occurred.
- Same-block anchoring (project mandate) was 100% achieved across 1,011 observations — cross-block contamination zero.

## 8. Files in this archive

| File | Purpose |
|---|---|
| `phase2a2_summary.md` | This file — the episode record |
| `behavioral_viability_report.md` | Analyzer's full report at the moment of verdict |
| `spread_distribution.csv` | 1,011 same-block observations (raw, auditable, re-derivable) |
| `surface_config.json` | Surface config at time of rejection (moved from `surfaces/`) |

## 9. Linked commits

- Collector built + committed: `research(phase2a.2): add arbitrum DAI/USDC behavioral collector`
- Analyzer built + committed: `c322e41` — `research(phase2a.2): add arbitrum DAI/USDC behavioral analyzer`
- This archive: see commit referenced in archive history

---

**Status:** archived and closed. Active candidate set updated (`surfaces/registry.json`: entry removed). The broader inventory thesis remains unresolved; the specific DAI/USDC Uni ↔ Camelot hypothesis is now settled.
