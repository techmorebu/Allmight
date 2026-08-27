# Ramses-Class Surface Characteristics — Research Notebook

**Status:** ACTIVE
**Initialized:** 2026-06-02 (Boss directive, Wave 7 opening)
**Current sample:** n = 13 classified surfaces (12 investigated under 4-class + 1 V4.1 Tier 1 catalog)
**Target sample:** n = 15-20 classified surfaces before strong claims about a predictive model

---

## Purpose

Catalog every classified surface across all chains and DEX families to:

1. Identify shared characteristics among `EXECUTION_READY` surfaces (n=1)
2. Identify shared characteristics among `BEHAVIORALLY_DEAD` surfaces (n=2)
3. Identify shared characteristics among `ECONOMICALLY_BLOCKED` surfaces (n=1)
4. Identify shared characteristics among `STRUCTURALLY_DEAD` surfaces (n=8)
5. Detect predictive variables — which features correlate with viability?
6. Build toward an empirically-grounded predictive model

**Boss's central research question (Wave 6 verdict, reaffirmed post-Wave 8):**

> "Is Ramses unique, or does another chain contain a second Ramses-class surface?"

Refined post-Wave 8 to:

> "What combination of variables produces a Ramses-class surface?
>  Protocol lineage is necessary but not sufficient."

---

## Variable necessity model (Boss canonical, updated 2026-06-04)

After Wave 8, the model now includes protocol lineage as a HELPFUL but
NOT SUFFICIENT input:

| Variable | Necessary? | Sufficient? | Direct counterexample |
|----------|-----------|-------------|----------------------|
| Depth (active-tick) | **Yes** | No | Unichain Velo V2 $88; Sonic Shadow V2 $79 |
| Behavioral signature (loose tracking) | **Yes** | No | Base/Optimism Slipstream |
| Spread distribution | **Yes** | No | Base Aero V2 (max 31bp < 37bp floor) |
| Fee structure | **Yes** | No | Base Aero V2 (37bp combined floor) |
| Protocol lineage (Ramses-family) | No | No | Sonic Shadow (Ramses V3, fails depth) |
| V2 architecture | Maybe | No | (no CL EXECUTION_READY observed) |

**Boss principle (canonical 2026-06-04):**

> Protocol lineage is HELPFUL — it predicts where to LOOK.
> Protocol lineage is NOT SUFFICIENT — all four operational variables
> (depth, behavior, distribution, fees) must still align independently.

---

## Surface table (n = 10)

| # | Chain | Pair | Dominant venue | Tracking venue | Pool types (D/T) | Fees D/T (bp) | Depth (active-tick) | Leader | Spread mean | Spread max | Spread p99 | Floor (bp) | Wave | Verdict |
|---|-------|------|---------------|----------------|------------------|--------------:|---------------------|--------|------------:|-----------:|-----------:|-----------:|------|---------|
| 1 | Arbitrum | ETH/USDC | UniV3 0.05% | Ramses V2 0.05% | V3 / V2 | 5 / 5 | ~$7M total* | UniV3 leads | ~8 bp | ~35 bp | n/a | ~10 | W2-3 | `EXECUTION_READY` |
| 2 | Arbitrum | ETH/USDT | UniV3 | Camelot V3 | V3 / Algebra | 5 / various | depth fail | n/a | n/a | n/a | n/a | n/a | W2 | `STRUCTURALLY_DEAD` |
| 3 | Arbitrum | ETH/USDT | UniV3 | SushiSwap V3 | V3 / V3 | 5 / various | depth fail | n/a | n/a | n/a | n/a | n/a | W2 | `STRUCTURALLY_DEAD` |
| 4 | Arbitrum | WBTC/USDC | UniV3 | SushiSwap V3 | V3 / V3 | 5 / various | depth fail | n/a | n/a | n/a | n/a | n/a | W3 | `STRUCTURALLY_DEAD` |
| 5 | Arbitrum | DAI/USDC | UniV3 | Camelot V3 | V3 / Algebra | 1 / various | depth fail | n/a | n/a | n/a | n/a | n/a | W1 | `STRUCTURALLY_DEAD` |
| 6 | Base | ETH/USDC | UniV3 0.05% | Aerodrome Slipstream ts=100 | V3 / Slipstream | 5 / 4 | ~$509M (stable) | UniV3 leads (presumed) | ~1 bp | ~3 bp | ~2 bp | ~9 | W4 | `BEHAVIORALLY_DEAD` |
| 7 | Base | ETH/USDC | UniV3 0.05% | Aerodrome V2 volatile | V3 / V2 | 5 / 30 | ~$1-3M | UniV3 leads (bidirectional) | ~8 bp | 31.28 bp | ~25 bp | 37 | W5 | `ECONOMICALLY_BLOCKED` |
| 8 | Optimism | ETH/USDC | Velodrome Slipstream ts=100 | UniV3 0.05% | Slipstream / V3 | 1 / 5 | $19k-$351k (churn) | Velodrome leads 74.7% | 1.08 bp | 4.00 bp | 3.00 bp | 6 | W6 | `BEHAVIORALLY_DEAD` |
| 9 | Unichain | ETH/USDC | UniV3 0.30% | Velodrome V2 | V3 / V2 | 30 / 30 | UniV3 0.30%: $2.9M; **Velo V2: $88** | n/a (no probe) | n/a | n/a | n/a | ~60+ | W7 | `STRUCTURALLY_DEAD` |
| 10 | Sonic | wS/USDC | Shadow V3 ts=50 (Ramses V3) | Shadow V2 volatile | Ramses V3 / Solidly V2 | 28 / 30 | Shadow V3: **$1.22M**; **Shadow V2: $79** | n/a (no probe) | n/a | n/a | n/a | ~58+ | W8 | `STRUCTURALLY_DEAD` |

\* Active-tick depth not formally measured for Ramses in earliest waves; figure is approximate total TVL.

### Scoreboard

```
EXECUTION_READY        1   (Arbitrum Ramses)
BEHAVIORALLY_DEAD      2   (Base + Optimism Slipstream)
ECONOMICALLY_BLOCKED   1   (Base Aero V2)
STRUCTURALLY_DEAD      6   (4× Arbitrum + Unichain + Sonic)
                     ─────
total                 10
```

---

## Pattern observations

### Pattern 1: CL-family tracking efficiency (n=2 confirmations, predictive)

Surfaces 6 and 8 (Base Slipstream and Optimism Velodrome Slipstream) both
classify as `BEHAVIORALLY_DEAD` despite:
- Different depths ($509M vs. $19k-$351k churning)
- Different lead/lag patterns (UniV3-led on Base, Velodrome-led on Optimism)
- Different LP defense mechanisms (size-based vs. churn-based)

Common feature: **Slipstream pool type (Solidly-fork CL)**. The architecture
itself appears to produce efficient tracking regardless of depth or which
side leads. This was the framework's first predictive success — Base CL
behavior predicted Optimism CL outcome, confirmed by probe.

### Pattern 2: V2 architecture necessary but not sufficient (n=3 confirmations after W8)

V2 architecture alone does not guarantee viability. Multiple gates must
ALSO be passed (depth, tracking quality, fees).

Direct counterexamples now on record:
- **Surface 7 (Base Aero V2):** V2 present, depth ample, lag exists, but
  fees too high → `ECONOMICALLY_BLOCKED`
- **Surface 9 (Unichain Velo V2):** V2 present, but depth absent
  ($88 active-tick) → `STRUCTURALLY_DEAD`
- **Surface 10 (Sonic Shadow V2):** V2 present, but depth absent
  ($79 active-tick) → `STRUCTURALLY_DEAD`

The "V2 present + depth absent" failure mode now has n=2 confirmations
across distinct chains.

### Pattern 3: Unichain UniV3 fee-tier depth inversion (n=1, novel observation)

Standard fee-tier depth pattern (Arb/Op/Base for ETH/USDC): 0.05% deepest,
0.30% modest. **Unichain ETH/USDC pattern:** 0.30% tier ($2.9M) is 20×
deeper than the 0.05% tier ($143.7K). Inverted from the cross-chain norm.

Hypothesis: Uniswap v4 captures most volume on Unichain (Uniswap's own L2),
forcing residual v3 liquidity to migrate to higher-fee tier.

### Pattern 4: Ramses-family candidate class (Boss canonical, formalized W8)

The hypothesis evolved through Wave 8 from a single-variable test to a
multi-requirement candidate class definition.

**Requirements (all four must align for EXECUTION_READY):**

1. **Ramses-family deployment** — protocol lineage matches the proven
   Arbitrum Ramses architecture (V2 or V3)
2. **Deep counterpart liquidity** — V2 or alternative tracking venue
   must have Ramses-class depth (~$5M+ active-tick)
3. **Loose-tracking behavior** — CL repricing lags V2/tracking venue
   sufficiently to produce spreads above floor
4. **Favorable fee economics** — combined floor low enough that
   achievable spreads cross it

**Current evidence:**

| Surface | (1) Lineage | (2) Counterpart depth | (3) Loose tracking | (4) Fees | Verdict |
|---------|:-----------:|:---------------------:|:------------------:|:--------:|---------|
| Arbitrum Ramses | ✓ | ✓ | ✓ | ✓ | EXECUTION_READY |
| Sonic Shadow    | ✓ | ✗ | not tested | not tested | STRUCTURALLY_DEAD |

**Status:** Pattern 4 is **UNRESOLVED** — neither confirmed nor falsified.
Confirmation requires another Ramses-family deployment with sufficient
counterpart depth, where the behavioral signature can actually be probed.

### Pattern 5 (tentative — n=2 suggestive): Modern chains skip V2 architecture

Two chains launched/rebranded since ~late 2023 have shown the same
"V2 present + depth absent" pattern:

| Chain | Launched | V2 fork active depth | Verdict |
|-------|----------|---------------------:|---------|
| Unichain | 2024 | $88 (Velodrome V2) | STRUCTURALLY_DEAD |
| Sonic    | 2024 (rebrand) | $79 (Shadow V2) | STRUCTURALLY_DEAD |
| **Mantle** | **July 2023** | **$804 (Cleopatra Legacy WMNT/USDC)** | STRUCTURALLY_DEAD |

**Refined hypothesis (Boss canonical post-Wave 9):** Ramses-family V2 forks
OUTSIDE Arbitrum do not accumulate Ramses-class depth. Mantle (July 2023,
older than Unichain and Sonic) confirms the pattern crosses chain
generations — the original "modern chains skip V2" framing was wrong.
The deeper pattern is that the Arbitrum Ramses V2 outcome does NOT
replicate to forks regardless of chain age.

**Wave 10A extension (intra-Arbitrum):** The intra-chain test confirmed
the same result. Chronos (measured: $9.3K best depth) and SolidLizard
(cataloged: ~$35K TVL) provide n=2 INSIDE Arbitrum evidence that Ramses
is uniquely viable on its own chain. Pattern 5 (n=3 chain-external) and
Pattern 6 (n=2 intra-Arbitrum) combine into a stronger claim formalized
in the Ramses uniqueness analysis below.

**Implication:** Lineage-based search (find another Ramses fork) is
weakened substantially. Three external Ramses-family deployments
across three chain generations all failed the depth gate before
behavioral test could run. Boss C9 ruling 2026-06-04: Ramses lineage
remains a useful search prior but is NO LONGER the primary search
strategy. Wave 10 will broaden beyond Ramses lineage.

n=3 substantially strengthens this — HIGH confidence finding.

---

## Open questions for future investigation

1. **Pattern 4 confirmation/falsification.** Where is the next Ramses-
   family deployment with adequate V2 counterpart depth? Candidates:
   Ramses V2 on Mantle (if exists), other Ramses forks on older chains.

2. **Pattern 5 confirmation — ANSWERED (Wave 9).** Mantle (July 2023,
   older than Unichain 2024 and Sonic 2024-rebrand) had Cleopatra
   Legacy max depth of just $804 on WMNT/USDC volatile. The "older
   chain" hypothesis failed — chain age does not explain V2 depth.
   Pattern 5 strengthened to n=3 across chain generations. New
   questions: are there ANY Ramses-family V2 deployments outside
   Arbitrum with > $100k depth? Or is Arbitrum Ramses V2 a singular
   case?

3. **V2 architecture necessity.** No CL surface has achieved
   EXECUTION_READY (n=10). A CL EXECUTION_READY would falsify the V2
   necessity hypothesis. Worth keeping eyes open.

4. **Same-protocol vs cross-protocol surfaces.** Boss approved
   same-protocol pairing (Shadow V3 × Shadow V2) as a valid surface
   structure. The Pattern 4 hypothesis test on Sonic was same-protocol
   by design. If a future Ramses-family chain has cross-protocol
   counterparts available, would those produce different behavioral
   signatures than same-protocol?

5. **Active-tick depth threshold for EXECUTION_READY.** Arbitrum
   Ramses has ~$7M; Base Aero V2 ($1-3M) was ECONOMICALLY_BLOCKED on
   FEES not depth. The lower bound is unclear. A surface with $500k
   depth and good fees has never been tested.

---

## Probability estimates (Boss model, post-Wave 8)

| Event | Probability |
|-------|------------:|
| Another EXECUTION_READY surface exists somewhere | ~60% (down from 65% post-W9 — Wave 10A further narrowed the space) |
| ...via Solidly-V2 lineage search (any chain) | ~5% (down from ~20%; Patterns 5+6 effectively close this lane) |
| ...via Class A on non-tested architectures | ~30% (Liquidity Book, Maverick, Curve V2 untested) |
| ...via Class B-H opportunity classes (Wave 10B direction) | ~50% (V4.1 opens new lanes) |
| Ramses-on-Arbitrum is a singular phenomenon | HIGH confidence (Pattern 5 + Pattern 6 = n=5 confirming) |
| Pattern 4 (Ramses candidate class) is correct framing | RETIRED under V4.1 (lineage downgraded to search prior; original question replaced) |
| Pattern 5 (Ramses V2 outside Arbitrum doesn't replicate) holds | HIGH confidence (n=3 chain-external) |
| Pattern 6 (Ramses unique INTRA-Arbitrum) holds | HIGH confidence (n=2 intra-chain, no confounders for SolidLizard) |
| Stable-curve cross-wave artifact (n=4) is real | HIGH confidence (Sonic, Mantle ×2, Chronos) |

Sonic was the first test of Pattern 4 — passed LINEAGE (✓), failed
DEPTH gate (✗). Mantle was the second test (Wave 9) — passed LINEAGE (✓,
authorized BUSL-1.1 fork), failed DEPTH gate (✗, max $804). Both failed
before behavioral signature could be probed.

Wave 10A added two intra-Arbitrum tests: Chronos (measured $9.3K) and
SolidLizard (Tier 1 catalog under V4.1, ~$35K TVL). Both also failed
the depth gate. Pattern 4 has now been TESTED FOR TESTABILITY five
times (Sonic, Unichain, Mantle, Chronos, SolidLizard); five times the
answer to 'can we even test it?' has been NO.

Pattern 4 confidence remains uncertain BUT lineage-based search was
DOWNGRADED per Boss C9 ruling 2026-06-04, and the question itself was
FORMALLY RETIRED under Discovery Constitution V4.1 (2026-06-05):

> Retired: "Can we find another Ramses?"
> Replaced with: "What opportunity classes remain underexplored?"

See `docs/specs/DISCOVERY_CONSTITUTION_V4_1.md` for the full framework.

---

## Update protocol

Append a row when a new surface is classified. Update existing rows when
refined data arrives. Material findings get summarized in "Pattern
observations." When a pattern solidifies (n ≥ 3 confirmations), it can
be promoted to the canonical thesis at `docs/thesis/behavioral_signature.md`.

This notebook is the WORKING data layer. The thesis is the CRYSTALLIZED
summary.

---



---

## Pattern 6 — Ramses unique INTRA-Arbitrum (Wave 10A finding, n=2)

Established 2026-06-05 (Wave 10A closure).

Both non-Ramses Solidly V2 forks on Arbitrum that have been catalogued
or measured fail the depth gate decisively:

| Surface | Best canonical-pair depth | Total TVL | Failure mode | Confounder |
|---------|--------------------------:|----------:|--------------|------------|
| Chronos V1 | $9,300 (measured) | ~$78,600 | "Failed to retain" ($230M peak → 99.97% collapse) | USDC.e migration |
| **SolidLizard** | not measured (V4.1 Tier 1) | ~$35,100 | "Failed to launch" (never reached peak) | None |

Two distinct failure modes — "failed to retain" and "failed to launch" — converge on the same conclusion. The SolidLizard case is particularly clean because it has NO confounder (no migration impact at this TVL scale).

**Conclusion:** Within Arbitrum's Solidly V2 ecosystem, Ramses is the only viable EXECUTION_READY surface across the 2 measured/catalogued forks. Combined with Pattern 5 (n=3 chain-external), the project has 5 non-Ramses Solidly V2 deployments across 4 chains, ALL failing the depth gate.

---

## Stable-curve cross-wave observation — formalized (n=4)

Established 2026-06-05 (Wave 10A closure). Boss-flagged across multiple waves.

The "Solidly stable curve deployed for clearly-volatile pair" pattern is now recurring across four chains:

| Chain | Surface | Stable pool | Depth | Quoted price | Real spot price |
|-------|---------|-------------|------:|-------------:|---------------:|
| Sonic | Shadow V2 wS/USDC | exists | $0 | misconfigured | $0.034 |
| Mantle | Cleopatra Legacy WMNT/USDC | exists | $0 | $1,000 (anomalous) | $0.50-$0.93 |
| Mantle | Cleopatra CL WMNT/USDC fee=100 | exists | $0 | (irrelevant; CL zombie) | $0.50-$0.93 |
| Arbitrum | Chronos WETH/USDC.e | exists | $106 | $4,757 (anomalous) | $1,603 |

**Pattern:** Solidly-family deployments create stable+volatile curves for every pair regardless of whether the pair is actually stable. The stable curve mathematics assume ~1:1 reserve ratios; volatile pairs (WMNT/USDC, WETH/USDC) violate this. The pools mechanically exist but their quoted prices are unreliable.

**Implication:** Solidly stable curves should NEVER be probed when the underlying pair is non-parity. These pools exist as architectural artifacts of the dual-curve deployment template, not as economically meaningful surfaces.

**Not yet observed:** A stable curve on a true parity pair (e.g., USDC/USDC.e, USDC/USDT) producing executable depth. Future Class D (Stablecoin Basis) research may identify such surfaces.

---

## Ramses-on-Arbitrum uniqueness — Wave 10A formal finding (2026-06-05)

This section fulfills the Boss-directed Wave 10A objective: "After both are classified, write short Ramses uniqueness note."

### The finding

After 13 classified surfaces across 7 chains, the project's most robust framework-level finding is:

> **Ramses-on-Arbitrum's EXECUTION_READY outcome is a SINGULAR phenomenon, not a reproducible architectural property.**

### Evidence summary

**Inter-chain evidence (Pattern 5, n=3 — investigated):**

| Chain | Architecture | Best Solidly V2 depth | Verdict |
|-------|--------------|----------------------:|---------|
| Unichain | Velodrome V2 | $88 | STRUCTURALLY_DEAD |
| Sonic | Shadow V2 | $79 | STRUCTURALLY_DEAD |
| Mantle | Cleopatra Legacy | $804 | STRUCTURALLY_DEAD |

**Intra-Arbitrum evidence (Pattern 6, n=2 — Wave 10A):**

| Surface | Best canonical-pair depth | Failure mode | Confounders |
|---------|--------------------------:|--------------|-------------|
| Chronos V1 | $9,300 (measured) | Failed to retain ($230M → $78K) | USDC.e migration |
| SolidLizard | not measured (Tier 1) | Failed to launch (~$35K TVL since inception) | None |

**Combined:** Five non-Ramses Solidly V2 deployments across four chains and two failure modes. The closest peer (Chronos, intra-Arbitrum) fails by 750×. The farthest peers (Sonic, Unichain) fail by 88,000×.

### Why Ramses is unique — testable hypotheses (NOT confirmed in this project)

The data identifies Ramses-on-Arbitrum as singular but does not yet explain WHY. Possible contributing factors (in approximate order of CPT's confidence, none verified):

1. **Vote-direction governance retained capital flywheel.** Ramses's ve(3,3) governance directing emissions toward high-fee pools that actually attracted LPs — vs Chronos's emissions being absorbed by short-term yield farmers who exited at peak.
2. **GMX ecosystem integration.** Ramses had a meaningful liquidity relationship with GMX (the dominant Arbitrum perp protocol) which provided real fee revenue, not just emissions-driven volume.
3. **Camelot synergy.** Ramses appears to have had cooperative liquidity routing relationships with Camelot's Algebra-based V3 pools — neither competing for the same LP base nor cannibalizing each other.
4. **Earlier launch timing.** Ramses launched before Chronos and SolidLizard. Arbitrum's Solidly-V2 LP base may have been "locked in" to Ramses by the time competitors appeared.
5. **Team execution / public-vs-anonymous.** Ramses had a semi-public team relationship; Chronos and SolidLizard were anonymous. Possible coordination or trust premium.

None of these is confirmed. All are testable through Class G (Liquidity Migration) research and on-chain capital flow analysis. Wave 10B Class G track is the right place to investigate.

### What this means for capital deployment

**Capital deployment policy is UNCHANGED.** Arbitrum ETH/USDC × Ramses V2 remains EXECUTION_READY. Capital remains LOCKED. Broadcast remains LOCKED. The proven winner is UNTOUCHED.

What this finding DOES change: **future discovery effort**. We no longer expect to find "another Ramses" by hunting Solidly V2 forks. Wave 10B should pursue opportunity-class tracks (Flash Loan, Stablecoin Basis, Liquidity Migration, etc.) per V4.1.

### What this finding does NOT mean

This finding does NOT mean:
- Ramses will continue to produce EXECUTION_READY conditions forever (must continue monitoring; capital remains LOCKED until execution gates are re-verified for any new size)
- No other EXECUTION_READY surfaces exist anywhere (other opportunity classes — Flash Loan, Triangular, LSD — remain unexplored)
- Solidly V2 architecture is dead (we tested it for one specific opportunity class on five chains; it may still be viable for other classes)

The finding is narrow and well-supported:

> Within Class A (Cross-DEX Arbitrage) and within the Solidly V2 architecture family, Ramses-on-Arbitrum is the only viable EXECUTION_READY surface across the 5 measured/cataloged forks on 4 chains.

---
## Cross-references

- Project ledger: [../project_ledger.md](../project_ledger.md)
- Behavioral signature thesis: [../thesis/behavioral_signature.md](../thesis/behavioral_signature.md)
- Archive of rejected surfaces: [../archive/rejected_surfaces/](../archive/rejected_surfaces/)


---

## Wave 10B primitive stack — machinery findings (2026-06-05)

Wave 10B produced NO new surface findings. It built primitive machinery
under Discovery Constitution V4.1. The following observations were
generated by that machinery running against fixture inputs — they are
research findings about how the analytics stack behaves, not about
real market surfaces. Live telemetry (Wave 11) will replace synthetic
confidence with empirical confidence.

### Observation 1 — Depth-cap universality across scanners

Every scanner v1 fixture with an economically viable underlying
opportunity produced `bindingConstraint ∈ {LEG_SLIPPAGE, VENUE_SLIPPAGE}`
at the router's chosen optimal size. Class C's fixture bound on
Camelot ARB/USDC leg 2 depth ($52K). Class D's USDT fixture bound
on Curve depth ($3M). Class D's USDC.e fixture bound on the 500bp
tier depth ($3M). Across three distinct opportunity classes, the
same mechanism — weakest-venue depth — set the size ceiling.

**Implication for search:** Under V4.1 tier thresholds, Tier 2+
surfaces ($100K+ depth) may be the practical minimum for
opportunity-class execution regardless of which class the
opportunity belongs to. Sub-Tier-2 opportunities scale only in
capital regimes far smaller than current inventory.

### Observation 2 — `candidateHitRate − economicHitRate` is a distinct diagnostic

Persistence telemetry's most useful primitive: a surface may show
apparent basis or apparent cycle edge frequently (`candidate = true`)
while almost never producing net-positive execution after fees +
slippage + gas (`economic = false`). The fixture Shape C
(USDC/USDC.e migration-sensitive) exercised this diagnostic explicitly:
13.3% candidate hit rate, 0% economic hit rate.

**Implication:** Scanners running in isolation would keep reporting
"opportunity!" while c5 correctly flags this as showy but useless.
The router's SKIP path fires on `TELEMETRY_NEVER_ECONOMIC`, converting
a nominal opportunity into an explicit reject with reasoning trail.

**Boss's original prediction validated pre-live-data:** "A surface may
show discrepancies constantly but almost never produce net-positive
execution" — this is precisely what the fixture demonstrates, before
we've seen a single real market observation.

### Observation 3 — Binding-constraint transitions warn against static sizing

Persistence telemetry's Shape D fixture (16-block continuous economic
run through the WETH>USDC>ARB>WETH triangle) exercised three sequential
binding constraints: LEG_SLIPPAGE → LEG_DEPTH → SWAP_FEES over the
event's lifetime. `bindingConstraintTransitions = 2` flagged by the
aggregator, causing the router to emit `sizeRevalidationRequired = true`.

**Implication:** For surfaces with observed binding-constraint transitions,
a size decision made at t=0 based on scanner output may be executing
against a stale bottleneck by t=+5 blocks. Router c6 defers this to a
future execution planner but marks the surface for revalidation. The
distinction between "static-binding" and "dynamic-binding" surfaces is
now first-class in router output.

### Observation 4 — Latency survival stratifies execution mode

Persistence telemetry's four adversarial fixture shapes produced four
distinct latency-survival profiles:

| Shape | Same-block | +1 block | +2 block | +5 block | +10 block |
|-------|:----------:|:--------:|:--------:|:--------:|:---------:|
| A (Ramses-shaped burst)          | 100% | 100% | 100% |   0% |   0% |
| B (USDT-shaped oscillating)      | 100% |   0% |   0% |   0% |   0% |
| C (USDC.e never economic)        | null | null | null | null | null |
| D (Triangular persistent)        | 100% | 100% | 100% | 100% | 100% |

These profiles map onto Boss C9's `captureProfile` taxonomy:
`SAME_BLOCK_ONLY` (Shape B), `SHORT_WINDOW` (Shape A),
`PERSISTENT_WINDOW` (Shape D), `UNKNOWN_WINDOW` (Shape C). Wave 11
live telemetry will replace these synthetic profiles with empirical
observations of the proven Ramses surface plus any A/C/D opportunities
that appear during collection windows.

### Observation 5 — Class A explicit; Class B is composition modifier

Discovery Constitution V4.1 defined opportunity classes A-H. Router
c6 formalized how they compose in output:

- `["A"]`      — cross-DEX arb, inventory-funded
- `["A", "B"]` — cross-DEX arb, flash-financed
- `["C"]`      — triangular arb, inventory-funded
- `["C", "B"]` — triangular arb, flash-financed
- `["D"]`      — stable basis, inventory-funded
- `["D", "B"]` — stable basis, flash-financed

Class B correctly behaves as a financing overlay, not an opportunity
source. This clarifies a semantic that had been muddled in Wave 10B c2
scanner naming — the scanner is a Class B scanner because it evaluates
financing overlay usefulness, but the underlying arb it evaluates is
Class A.

### Observation 6 — Fixture-vs-Live separation is architecturally enforced

Boss C9 mandate 3 (locked 2026-06-05): "Fixture data must never become
empirical policy." Router c6 enforces this by refusing to promote any
opportunity above priority = WATCH when `telemetrySource = FIXTURE`.
The same router code will produce LOW/MEDIUM/HIGH decisions when fed
LIVE or REPLAY telemetry — no code change needed.

This means Wave 11 (live telemetry wiring) does NOT require modifying
router logic. It requires only providing a real observation source and
switching the `--telemetry-source` flag from FIXTURE to LIVE. The
router's routing decisions on real data will then be reproducible via
the same schema and reasoning trail that the fixture demonstrates.

### Cross-reference

Full architectural summary: [`docs/waves/wave_10b_summary.md`](../waves/wave_10b_summary.md)
