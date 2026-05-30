# Wave 3 — WBTC/USDC (uni_sushi) Candidate A: REJECTED + Chain-Level Finding

| Field | Value |
|---|---|
| **Surface (proposed)** | `arbitrum:WBTC/USDC:uni_sushi` |
| **Status** | `REJECTED` |
| **Rejection type** | `STRUCTURALLY_DEAD` |
| **Reason** | `INSUFFICIENT_ACTIVE_TICK_DEPTH` |
| **Boss verdict** | 2026-05-30 |
| **Wave** | 3 — WBTC/USDC investigation |
| **Stage** | Pre-integration (never reached the registry) |
| **Pair-level significance** | Only viable counterpart on arbitrum — **closes the pair** |
| **Chain-level significance** | **Third consecutive cross-venue rejection on arbitrum** — see §6 |

> The probe didn't just reject a candidate. The third confirmation crystallizes
> an architectural pattern about the arbitrum DEX ecosystem itself.

---

## 1. The hypothesis (pre-test)

After Wave 2 closed ETH/USDT as structurally unpairable on arbitrum, Boss directed Wave 3 at WBTC/USDC for these specific reasons:

- USDC is a healthy quote leg on arbitrum (not orphan like USDT)
- WBTC has substantial UniV3 presence ($73.5M TVL at 5bp tier)
- The directive marked WBTC/USDC as "not in fetcher at all" — green-field discovery
- Best a-priori chance of finding a second cross-venue winner

The CPT prior at probe time was MEDIUM-LOW: Sushi's $50.9k WBTC/USDC TVL was *less than* the $84.5k Sushi ETH/USDT TVL that had dusted at $21. But "likely dust" is not "measured dust" — the constitutional probe was the cheapest path to certainty.

| Component | Value |
|---|---|
| Pool A | uniswap_v3 WBTC/USDC 0.05% (`0x0E4831319A50228B9e450861297aB92dee15B44F`) |
| Pool B | sushiswap_v3 WBTC/USDC 0.05% (`0x699f628A8A1DE0f28cf9181C1F8ED848eBB0BBdF`) |
| Total venue fees | 10 bp (5 + 5) — *mismatched* vs proven winner's 6bp |
| Discovery TVL signal | uni 5bp: $73.5M  ·  sushi 5bp: $50.9k |
| Ramses presence | **None** — confirmed across all 3 fee tiers at discovery |
| Camelot presence | $31 TVL at 15bp tier — dust at discovery, no probe needed |

Important architectural detail: this was the **first non-ETH-pair probe**, requiring different decimals (WBTC = 8, USDC = 6 — distinct from the 18/6 of WETH-quoted pairs). Decimals were validated via smoke test before the full run; price math returned $73,519 (matched discovery's $73,599 within minor tick movement).

## 2. The probe

- **Tool:** `scripts/research/surface_depth_probe.js` — constitutional gate (commit `b883d61`)
- **Third operational use** of the generalized probe (first non-ETH-pair use)
- **Run:** 60 observations over 29.5 minutes, 30-second cadence
- **Window:** 2026-05-30 17:39 → 18:09 UTC
- **Same-block reads:** 60 / 60 (100%, `blockTag`-anchored)
- **RPC errors:** 0

## 3. The result

```
Active-tick depth (L×sqrtP-derived USD)
  uniswap_v3 5bp:    $18,360 - $18,826  (stable, real LP at the live tick)
  sushiswap_v3 5bp:  $12.73 - $12.73    ← LITERALLY CONSTANT across 60 obs

Spread distribution (60 same-block observations)
  min 0.135 bp  ·  P50 6.589 bp  ·  P90 7.898 bp  ·  max 8.486 bp

Comparative depth ratios
  uni : sushi     = ~1,479×  (uni has ~1,500× more executable depth)

  Cumulative ratios across investigations:
    ETH/USDT uni:camelot  → ~∞ (cam = $0)
    ETH/USDT uni:sushi    → ~600×
    WBTC/USDC uni:sushi   → ~1,500× ← highest yet
```

The constant $12.73 across all 60 observations is the most striking single data point in this session's research. It means:

- The sushi LP position spans a wide-enough tick range that the active tick range never crossed an LP boundary during the 29.5-minute window.
- Within that wide-spanning position, the *concentration is so thin* that a 10-bp slice (one tick at 5bp fee tier) contains ~$13 of LP value.
- This is the **architecture of dust**: not "no LP" but "LP spread so thinly across the curve that no executable slice exists at the live price."

Additionally, the spread distribution (median 6.6 bp, max 8.5 bp) is the *widest* observed across all three rejected surfaces. Sushi prices lag uni by more than half a basis point on average — and there's no executable counterparty to capture that lag against.

## 4. Boss verdict (2026-05-30)

```
SURFACE_STATUS  = REJECTED   (pre-integration; never registered)
REJECTION_TYPE  = STRUCTURALLY_DEAD
REASON          = INSUFFICIENT_ACTIVE_TICK_DEPTH

The sushiswap_v3 WBTC/USDC 5bp pool reports $50.9k TVL distributed
thinly enough across the price curve that the active 10bp tick range
holds ~$12.73 of executable liquidity. A $1k arb would consume ~80×
the depth — slip would dominate any spread captured.

Same disqualifying pattern as both ETH/USDT candidates, with greater
magnitude (deepest depth ratio observed; widest spread distribution).
```

## 5. Pair-level conclusion — WBTC/USDC on arbitrum is CLOSED

```
Only viable counterpart tested:
  Candidate A: uni 5bp ↔ sushi 5bp  →  REJECTED ($12.73 ATD)

Other venues at discovery (no probe warranted):
  Camelot 15bp: $31 TVL  → dust at discovery
  Sushi 30bp:   $16 TVL  → dust at discovery
  Sushi 1bp:    $0 (anomalous broken pool, price $2.5M)
  Ramses:       absent across all 3 fee tiers

CONCLUSION: arbitrum WBTC/USDC is STRUCTURALLY UNPAIRABLE at current
liquidity conditions. The uni-vs-non-uni venue gap is even wider than
for ETH/USDT. There is no counterpart venue with measurable executable
depth at the live price.
```

## 6. CHAIN-LEVEL FINDING — escalation to Boss

> **This section is the architectural finding, not a per-pair archive note.**
> It documents a pattern that now affects strategic direction at the
> chain-selection level and may motivate revisiting Boss's chain prioritization.

### 6.1 The evidence

Three rejections, two pairs, one chain, one consistent mechanism:

| Investigation | TVL (counterpart) | ATD (counterpart) | Spread (P50) | Verdict |
|---|---|---|---|---|
| ETH/USDT  uni+camelot | $264.9k | ~$0 | 1.8 bp | DEAD |
| ETH/USDT  uni+sushi   | $84.5k  | $21.12 | 3.8 bp | DEAD |
| WBTC/USDC uni+sushi   | $50.9k  | $12.73 | **6.6 bp** | DEAD |

Plus the discovery-stage filter (Camelot WBTC/USDC at $31 TVL, Sushi 30bp tiers at $16, Ramses absent for both non-ETH/USDC pairs).

### 6.2 The pattern

```
Across major arb-eligible pairs on arbitrum, EXCEPT ETH/USDC:
  UniswapV3 holds the dominant ($50M+) deep LP at the 5bp tier
  Sushiswap/Camelot hold notional TVL ($50-265k) but ~$0-21 active-tick depth
  Ramses is either absent (WBTC/USDC) or trivial (ETH/USDT $9 TVL)

The ETH/USDC Ramses ↔ UniV3 winner is structurally unique:
  Ramses concentrates real LP at the live tick (because Ramses governance
  incentivizes ETH/USDC specifically via veRAM emissions, per public docs)
  That same concentration does NOT extend to other pairs on Ramses
  And no other venue replicates it for non-ETH/USDC pairs
```

### 6.3 The hypothesis

The arbitrum DEX ecosystem outside of UniswapV3 has structurally limited venue diversity for arb purposes. The single deep cross-venue surface (ETH/USDC ramses↔uni) is a function of Ramses's specific incentive program around ETH/USDC, not a representative pattern across the chain.

### 6.4 Strategic implications

If the hypothesis holds, the arbitrum-only investigation runway is shorter than it appeared:

```
PRIORITY 1 list (Boss directive April 2):
  ETH/USDT     ✅ tested + rejected (pair closed)
  WBTC/USDT    ⏸️ predicted to follow same pattern (USDT orphan stacks
                  with the venue diversity constraint — likely double-fail)
  WBTC/USDC    ✅ tested + rejected (pair closed; this commit)

PRIORITY 2 list (less promising via the new lens):
  LINK/USDC, GMX/USDC, UNI/USDC, DAI/USDC
  → Same UniV3-dominant pattern is the modal case. Each probe is still
    cheap, but the expected yield per probe is now low.

POSSIBLE DIRECTION PIVOTS for Boss to consider:
  A) Continue arbitrum Priority 2 probes (cheap; closes the chain definitively)
  B) Pivot to base / optimism / unichain (different DEX ecosystems with
     different venue diversity profiles — Aerodrome on base, Velodrome on
     optimism, Uniswap-only-but-deep-everything on unichain)
  C) Accept the single-winner reality and pivot to Wave 4 (inventory
     operational feasibility for ETH/USDC ramses — extract maximum value
     from the one confirmed winner)

CPT does NOT recommend a direction here — this is a strategic decision
that belongs to Boss. The research engine will execute whichever path
is chosen with the same constitutional discipline.
```

### 6.5 What this finding does NOT claim

- It does not say arbitrum has no arb opportunities — ETH/USDC Ramses remains a measured, behaviorally-confirmed winner.
- It does not say venue diversity is "permanently broken" — liquidity conditions change; a major LP could position deep WBTC/USDC concentrated liquidity tomorrow.
- It does not say UniV3 is the "only good DEX" — Ramses works extremely well *for ETH/USDC*. The constraint is venue × pair, not just venue.
- It does not preclude inventory-model winners — the active-tick constraint applies to flash arbs that require atomic execution against counterparty LP; inventory arbs route differently.

## 7. Architectural validation — the probe works (third operational success)

- Third consecutive operational use; no math errors, no infrastructure issues, no fetcher contamination.
- First non-ETH-pair use (different decimals, different tickSpacing handling — all worked correctly).
- Total RPC cost across all 3 probe-driven rejections: ~90 minutes.
- Total infrastructure contamination (fetcher / registry / scorer / behavioral pipeline / executor): **zero, across all three.**

The "Discovery → Depth Probe → Classification" rule (Boss, 2026-05-30) has now demonstrated its value three times. The constitutional gate is doing the work it was designed to do — and it's also become the primary instrument generating chain-level architectural findings, not just per-surface verdicts.

## 8. Files in this archive

| File | Purpose |
|---|---|
| `wave3_candidate_a_summary.md` | This file — episode + chain-level finding |
| `pre_integration_probe_report.md` | Probe result detail (distribution + depth stability) |
| `pool_probe_observations.csv` | 60 same-block observations (raw, auditable) |

## 9. Linked artifacts

- Wave 2 archives (siblings of this finding):
  - `docs/archive/rejected_surfaces/arbitrum_eth_usdt_uni_camelot/`
  - `docs/archive/rejected_surfaces/arbitrum_eth_usdt_uni_sushi/`
- Probe tool: `scripts/research/surface_depth_probe.js` (constitutional gate; b883d61)
- Discovery output: `logs/research/wave3/wbtc_usdc_discovery.{log,json}` (gitignored)
- Probe raw data: `logs/research/wave2/wbtc_usdc_uni_sushi_pool_probe.jsonl` (gitignored — preserved in CSV form here; the wave2 path is a hardcoded `OUT_DIR` in the probe — a minor cosmetic issue to address in a future probe enhancement)

---

**Status:** archived. Wave 3 WBTC/USDC investigation is closed. The chain-level finding (§6) is the substantive output of this wave — escalated to Boss for next-direction decision.
