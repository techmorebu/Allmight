# Optimism ETH/USDC × Velodrome Slipstream ts=100 — Wave 6 Archive

## Verdict

**Classification**: `BEHAVIORALLY_DEAD`  
**Confidence**: HIGH  
**Date**: 2026-06-02  
**Ruled by**: Boss (C9 ruling)

## Surface

| Field | Value |
|-------|-------|
| Chain | Optimism (chainId 10) |
| Pair | ETH/USDC (native USDC at `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85`) |
| Pool A | UniswapV3 0.05% — `0x1fb3cf6e48F1E7B10213E7b6d87D4c073C7Fdb7b` |
| Pool B | Velodrome Slipstream ts=100 — `0x478946BcD4a5a22b316470F5486fAfb928C0bA25` |
| Fee floor | 6 bp (5 bp UniV3 + 1 bp Slipstream) |
| Total floor (incl. gas) | ~9 bp |

## Evidence

### 4-hour probe (canonical evidence)
- **File**: `4hr_probe.jsonl`
- **Observations**: 476 same-block (100% data quality)
- **Window**: 2026-06-01 23:00 → 2026-06-02 03:00 UTC
- **Block range**: 152378035 → 152385225 (7,190 blocks)
- **Errors**: 4 RPC timeouts (0.83% failure rate)

### Spread distribution

| Metric | Value |
|--------|-------|
| Mean | 1.08 bp |
| StdDev | 0.65 bp |
| Min | 0.00 bp |
| p25 | 0.60 bp |
| p50 | 1.00 bp |
| p75 | 1.40 bp |
| p90 | 1.80 bp |
| p95 | 2.19 bp |
| p99 | 3.00 bp |
| **Max** | **4.00 bp** |

### Threshold crossings

| Threshold | Count | % | Note |
|-----------|-------|---|------|
| ≥ 1 bp | 253 | 53.15% | |
| ≥ 2 bp | 33 | 6.93% | |
| ≥ 3 bp | 5 | 1.05% | |
| ≥ 4 bp | 1 | 0.21% | single observation, ~30 sec |
| ≥ 5 bp | 0 | 0.00% | |
| ≥ 6 bp | 0 | 0.00% | **FEE FLOOR — never crossed** |
| ≥ 9 bp | 0 | 0.00% | TOTAL FLOOR — never crossed |

### Sustained events (max consecutive obs above threshold)

| Threshold | Max consecutive | Approx. duration |
|-----------|-----------------|------------------|
| ≥ 1 bp | 17 obs | ~8.5 min |
| ≥ 2 bp | 2 obs | ~1.0 min |
| ≥ 3 bp | 2 obs | ~1.0 min |
| ≥ 4 bp | 1 obs | ~30 sec |
| ≥ 5 bp | 0 | 0 |
| ≥ 6 bp | 0 | 0 |

### Lead/lag analysis (357 tick-change events)

| Pattern | Events | % |
|---------|--------|---|
| Both moved same direction | 86 | 24.1% |
| Both moved different direction | 172 | 48.2% |
| Only Velodrome moved (Velodrome led) | 74 | 20.7% |
| Only UniV3 moved (UniV3 led) | 25 | 7.0% |

**Of one-venue-only events (99 total): Velodrome-leads bias = 74.7%**

This is the OPPOSITE of Arbitrum (UniV3 leads Ramses). Velodrome
Slipstream is the price-discovery dominant venue on Optimism; UniV3
0.05% is the tracking venue.

### Tick offset (b.tick - a.tick)

| Metric | Value |
|--------|-------|
| Min | -3 ticks |
| p50 | 0 ticks |
| p95 | 2 ticks |
| Max | 4 ticks |
| Mean | 0.09 ticks |
| Same-tick observations | 113 (23.7%) |

Despite the Velodrome-leads asymmetry, UniV3 catches up within ~1 tick
precision. Tracking quality is TIGHT (no persistent gap larger than 4
ticks).

### Depth stability

**Pool A (UniV3 0.05%, tickSpacing=10):**  
Min $1,164 | p50 $1,529 | p95 $1,767 | Max $1,768 | Mean $1,474 — stable.

**Pool B (Velodrome Slipstream ts=100):**  
Min $18,835 | p50 $46,238 | p95 $233,667 | Max $350,906 | Mean $75,632.  
**Range ratio: 18.6× — structural LP churn signature**.

The Velodrome pool exhibits aggressive LP rebalancing within the active
range. This is a different mechanism than Aerodrome Slipstream on Base
(which used stable $500M-class depth) — yet produces the same efficient
tracking outcome.

### Market context (anti "quiet-market" verification)

ETH price during probe: $1,963.90 → $2,005.74 (~$42, ~2% range).

The market moved meaningfully. The spread distribution still remained
bounded below the fee floor. Quiet-market explanation is RULED OUT.

## Key conclusion (Boss's reasoning)

```
476 same-block observations
100% data quality
4-hour window
2% ETH move
max spread = 4.0 bp
floor = 6 bp
```

A quiet market could explain low spreads. A 2% ETH move removes that
excuse. The market moved. The spread distribution remained bounded.
That is the key evidence.

## Strategic significance

This is the **second** BEHAVIORALLY_DEAD CL-family classification in the
project (after Base Aerodrome Slipstream, Wave 4). Together they
establish that **Solidly-fork concentrated-liquidity surfaces exhibit
efficient market tracking across multiple chains** — a thesis-level
finding.

The Velodrome-leads finding (74.7% bias) generalized the thesis from
"UniV3 leads price discovery" to "dominant venue varies by chain; what
matters is the tracking venue's behavior." See
`docs/thesis/behavioral_signature.md` Wave 6 Result + Framework
Refinement sections.

## Files

- `4hr_probe.jsonl` — canonical 4-hour probe (476 obs, 463 KB)
- `30min_probe.jsonl` — initial 30-min probe (59 obs, 57 KB)
- `4hr_probe_stdout.log` — runtime log
- `discovery_v1.log` — initial discovery (token-order bug surfaced)
- `discovery_v2.log` — after chain-portable depth math fix
- `discovery_v3.log` — after V3 priceMode fix (final clean)

## Wave 6 commit history

- `b109884` wave6(commit 1): Optimism chain integration
- `0b2d58a` wave6(commit 2): chain-portable depth math
- `127d7f2` wave6(commit 3): V3 priceMode 'invert' support
- `f8adc3d` wave6(commit 4): probe stable-side awareness
- (this commit) wave6(commit 5): close-out
