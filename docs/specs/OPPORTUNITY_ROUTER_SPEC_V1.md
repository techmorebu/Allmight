# Wave 10B — Opportunity Router Specification V1

**Status:** ACTIVE (locked-in 2026-06-05, Wave 10B kickoff)
**Boss ruling:** C9 2026-06-05 (Wave 10B direction + architecture)
**Constitutional foundation:** [Discovery Constitution V4.1](DISCOVERY_CONSTITUTION_V4_1.md)
**Supersedes:** nothing (V4.1 remains in force; this spec adds architecture and refinement)
**Applies to:** all Wave 10B and forward discovery work

---

## Purpose

Wave 10B evolves AllMight from single-class chain-by-chain discovery
into a **multi-class opportunity-routing architecture**.

The Wave 10A pivot ("classify first, investigate only if promoted")
saved the operator time cost of investigating Tier 0/1 surfaces.
Wave 10B extracts more information per surface by asking multiple
opportunity questions simultaneously instead of one at a time.

## The Wave 10B mission

> **Build the first multi-class CPT opportunity-routing specification
> using already-integrated Arbitrum markets before adding additional
> chains or architectures.**

Arbitrum is chosen because it already has everything needed to test
the multi-class approach:

- Proven Ramses EXECUTION_READY surface
- UniV3, SushiSwap V3, Camelot V3 venues integrated
- Multiple tokens/pairs configured (10 pairs, 5 venues post-Wave 10A)
- Mature infrastructure (RPC mesh, discovery, ranker, evaluator)
- Existing execution machinery (ArbitrageBot smart contract deployed)
- Actual capital (still LOCKED)

**The project stops paying the new-chain-integration tax temporarily
and squeezes more information out of infrastructure already built.**

---

## Motivation — why the multi-class shift

Waves 1-10A built discovery machinery around a single question:

> "Does venue A track venue B loosely enough for cross-DEX arbitrage?"

This yielded ONE winner (Ramses × UniV3) and 12 rejections. The
Ramses uniqueness finding (Wave 10A) closes the "find another
Ramses" search. Continued chain-by-chain expansion under the same
question would produce diminishing returns.

But every surface Waves 1-10A discovered contains **more** potential
opportunity data than just cross-DEX. The same on-chain measurement
that returns "$9,300 depth" for Chronos also reveals:

- Whether it's borrowable for flash-loan-sized trades
- Whether it participates in a triangular route through ARB or USDT
- Whether it's part of a stablecoin basis surface (USDC.e vs USDC)
- Whether it's exhibiting migration flow patterns (Class G data)

**One scan should potentially discover several kinds of opportunity.**
That's the architectural correction Wave 10B makes.

---

## V4.1 Refinement — Surface Tier vs Executable Capacity

V4.1 introduced the tier system (RULE 1) as a pre-screen for
integration effort. That framing served Waves 1-10A well but requires
refinement now that discovery targets multiple opportunity classes.

### Two concepts, not one

**Surface Tier** describes the market's general economic significance
(inherited from V4.1 RULE 1):

- Tier 0: <$1K
- Tier 1: $1K-$100K
- Tier 2: $100K-$1M
- Tier 3: $1M-$5M
- Tier 4: >$5M

Tier gates **integration effort** (whether to spend operator time
on factory verification, ABI dance, chains.json edits, and deep
behavioral study).

**Executable Capacity** describes how much capital a *specific route
in a specific class* can safely absorb.

Executable Capacity is a per-opportunity metric derived from:

- The weakest executable leg of the route (for triangular)
- The available borrow depth (for flash-loan-supported routes)
- The counterpart depth ratio (for cross-DEX)
- The parity distance and stable-pool depth (for stablecoin basis)

### Why the distinction matters

Under the OLD framing, a $75K pool would fail V4.1 Tier 1 (catalog
only) and never inform any executable decision. But that same $75K
pool might:

- Support a $500 inventory arbitrage trade (Class F) with executable
  capacity of $500
- Feed a $500,000 flash-loan route (Class B) with executable capacity
  of $50 (weakest leg dominates)
- Provide the middle leg of a triangular route with executable
  capacity of $2,000

Under the NEW framing:

- **Surface Tier = 1** (unchanged — catalog-only for expensive
  behavioral research such as full behavioral signature probes)
- **Class F Executable Capacity = $500** (viable if the trade is
  profitable at that size)
- **Class B Executable Capacity = $50** (probably not viable given
  fee floor)
- **Class C Executable Capacity as middle leg = $2,000** (viable if
  the outer legs support the cycle)

Wave 10B scanners compute Executable Capacity **cheaply** as part
of the routine scan. Tier remains the gate on integration effort;
Executable Capacity is the gate on individual route viability.

### Anti-pattern this prevents

We should never spend hours integrating $35K TVL protocols. That
policy stays.

But we should also never let an arbitrary TVL cutoff make the
arbitrage engine **blind** to small, unusually profitable
dislocations. Small routes with high per-unit edge exist; they're
valuable if the scanner already has the market data.

---

## Architectural model — the Opportunity Router

```
                    MARKET SURFACE
                          │
                          ▼
                 CHEAP PRE-SCREEN
                          │
       ┌────────┬─────────┼──────────┬──────────────┐
       ▼        ▼         ▼          ▼              ▼
     depth   volume     fees      tokens       borrowability
                          │
                          ▼
                 OPPORTUNITY ROUTER
                          │
  ┌────────┬────────┬────────┬────────┼────────┬────────┬────────┐
  ▼        ▼        ▼        ▼        ▼        ▼        ▼        ▼
  A        B        C        D        E        F        G        H
Cross-  Flash    Triang.  Stable-   LSD    Inventory Migration Direction
 DEX    Loan              coin
                          Basis
  │        │        │        │        │        │        │        │
  ▼        ▼        ▼        ▼        ▼        ▼        ▼        ▼
              CLASS-SPECIFIC GATES
  │        │        │        │        │        │        │        │
  └────────┴────────┴────────┴────────┴────────┴────────┴────────┘
                          │
                          ▼
            PROMOTE / CATALOG / REJECT
```

### Cheap pre-screen inputs

Every surface passes through the same cheap measurement suite:

| Input | Cost | Purpose |
|-------|------|---------|
| Active-tick depth | 1 RPC call | Route viability + Executable Capacity |
| Volume (last 24h) | Public API (DexScreener, DefiLlama) | Class F persistence, Class G migration signal |
| Fee tier | Static config | Class A/B/C/D economic viability |
| Token relevance | Static registry | Class B (borrowability), Class C (route graph) |
| Venue diversity | Static config | Class A, C route enumeration |
| Borrowability | Aave/Balancer registry | Class B qualification |

Output: a normalized surface record consumed by the Router.

### Opportunity Router logic

For each surface, the Router asks each active class:

> "Given this surface's measurements, is this class a candidate?"

Each class returns one of:

- `candidate` — worth further class-specific gate evaluation
- `not_applicable` — surface doesn't match class shape
- `insufficient` — surface matches shape but too thin for this class

### Class-specific gates

Once a class returns `candidate`, class-specific gates apply:

| Class | Gate |
|-------|------|
| A. Cross-DEX | Counterpart depth ratio ≥ 1% (V4.1 RULE 3 Gate B) + fee floor pass |
| B. Flash Loan | Borrow-execute-repay net edge > financing fee at sized route |
| C. Triangular | Weakest-leg executable capacity > cycle gas cost + fee sum |
| D. Stablecoin Basis | Parity distance > 2× fee floor + stable-pool executable depth |
| E. LSD | Peg deviation + redemption path present |
| F. Inventory | Frequency × per-trade edge > opportunity cost |
| G. Migration | Flow persistence + directional signal + read-only telemetry |
| H. Directional | Telemetry-only (no execution gate; feeds future models) |

### Scanner output evolution

The scanner output evolves from single-class verdict to multi-class
capability report:

```
SURFACE: Arbitrum ETH/USDC (Ramses)

Cross-DEX:         candidate (Ramses ↔ UniV3, ratio=1.0, existing winner)
Triangular:        routes available (ETH→USDC→ARB→ETH via Ramses+UniV3)
Flash financing:   available (Aave USDC pool ~$50M borrowable)
Stable basis:      N/A (not a stablecoin pair)
Inventory:         candidate (persistence data from existing runs)
Migration:         stable (no meaningful outflow observed)
Directional:       telemetry retained

Max safe size:     [computed per class]
Expected net:      [computed per class]
Confidence:        HIGH (n>480 observations)
Persistence:       [computed]

CPT verdict:       PROMOTE  Cross-DEX (existing EXECUTION_READY)
                   EVALUATE Triangular (new; needs route enumeration)
                   EVALUATE Inventory (new; needs persistence audit)
```

---

## Flash loans — capital mechanism, not opportunity source

Flash loans are NOT an independent opportunity class in the sense of
"scan for flash-loan opportunities." They are a **capital mechanism**
that improves the economics of an underlying arbitrage.

### The correct framing

A profitable flash-loan-supported opportunity is:

- `Cross-DEX + Flash Loan` — borrow, execute cross-DEX trade, repay
- `Triangular + Flash Loan` — borrow, execute cycle, repay
- `Stablecoin Basis + Flash Loan` — borrow, convert, repay

**The underlying arbitrage must work before financing.** This is the
guardrail against searching for "flash-loan opportunities" merely
because liquidity is borrowable.

### Economic equation for flash-loan-supported routes

```
gross opportunity
− swap fees
− slippage
− gas
− financing / flash-loan fee
− execution safety margin
────────────────────────────
= executable net edge
```

Wave 10B Class B scanner therefore computes TWO numbers per surface:

1. **Underlying arb net** (without financing) — must be positive
2. **Flash-loan sized net** (with financing, at meaningful trade
   size) — must be positive AND larger than underlying

If financing REDUCES net at meaningful size, the flash loan is not
useful for that route.

### Borrowable liquidity registry (new Wave 10B artifact)

Track (Arbitrum initially):

- Aave V3 USDC / USDC.e / USDT / DAI / WETH pool depths
- Aave V3 flash-loan fee schedule (typically 0.05%)
- Balancer V2 flash-loan capability (typically 0.0%)
- Current utilization rates (variable)
- Pool addresses and reference block

This registry becomes a scanner input, NOT an opportunity target.

---

## Track sequence — Wave 10B (Boss C9 ruling 2026-06-05)

Wave 10B implements four scanner tracks in this order:

| # | Track | Class | Rationale |
|---|-------|-------|-----------|
| 1 | **Flash Loan financing scanner** | B | Opens the largest new capability lane; validates the "capital mechanism" framing |
| 2 | **Triangular route scanner** | C | Cheapest expansion; uses existing venue/pair infrastructure; enlarges search graph without new chain integration |
| 3 | **Stablecoin Basis scanner** | D | Chronos exposed this lane (USDC.e vs USDC); high-information per hour |
| 4 | **Liquidity Migration analyzer** | G | Historical data already collected; improves candidate selection for other classes |

Classes E, F, H are deferred to Wave 10C or later.

### Why NOT Migration first (CPT proposal was reversed by Boss)

CPT initially proposed G first because "the data is already
collected." Boss corrected: the primary mission is building an
arbitrage engine that generates executable opportunities. Migration
intelligence improves candidate selection but shouldn't displace
profit-surface discovery.

Migration research remains valuable — it moves to fourth place,
still in scope.

---

## Existing Arbitrum infrastructure inventory

Before writing any new integration code, Wave 10B assesses what the
existing dataset can support:

| Capability | Existing data reusable? | New work required |
|------------|-------------------------|-------------------|
| Cross-DEX (Class A) | HIGH | LOW (already-classified surfaces) |
| Flash-loan financing (Class B) | PARTIAL | MEDIUM (borrowability registry, financing math) |
| Triangular (Class C) | HIGH | MEDIUM (route enumeration, cycle depth calc) |
| Stablecoin Basis (Class D) | HIGH | LOW-MEDIUM (USDC/USDC.e/USDT/DAI depth spread) |
| LSD (Class E) | LOW | LATER (no LSD pairs on Arbitrum in current config) |
| Inventory (Class F) | HIGH | MEDIUM (persistence data extraction from existing runs) |
| Migration (Class G) | Historical data exists (Chronos, USDC.e) | LOW (analyze existing) |
| Directional (Class H) | CONSIDERABLE | DEFERRED |

This inventory guides scanner build order — start where reusable
data is highest and new work lowest.

---

## Wave 10B constitutional sequence

Following V4.1 RULE 6 (capital protection) and RULE 2 (opportunity
first), the Wave 10B commit sequence is:

1. **Kickoff commit (this spec)** — architectural specification locked

2. **Wave 10B c1 — Borrowability registry** — Aave V3 + Balancer V2
   USDC/USDC.e/USDT/DAI/WETH pool sizes, fee schedules, utilization.
   Static config addition. No code changes to discovery pipeline.

3. **Wave 10B c2 — Class B (Flash Loan) scanner v1** — reads
   existing surface data + borrowability registry; computes
   flash-loan-sized net edge for each Cross-DEX-candidate surface.
   Read-only. No probe. No execution.

4. **Wave 10B c3 — Class C (Triangular) route enumerator** — builds
   cycle graph from existing arbitrum tokens/venues; computes
   weakest-leg executable capacity per cycle.

5. **Wave 10B c4 — Class D (Stablecoin Basis) scanner** — measures
   USDC/USDC.e/USDT/DAI depth spread and parity distance across
   existing Arbitrum venues. Includes stable-curve executable-depth
   probes (the Boss-flagged n=4 stable-curve anomaly is a known
   filter — non-parity pairs are excluded from D scanner even if
   architecturally present).

6. **Wave 10B c5 — Class G (Migration) analyzer** — post-hoc analysis
   of Chronos $230M→$78K collapse, USDC.e→native USDC migration flow
   patterns, SolidLizard failed-to-launch signal.

7. **Wave 10B c6 — Opportunity Router integration** — unified
   scanner output combining all class outputs into single
   surface-capability records per the diagram above.

Each commit reports:

- What was added
- Executable-capacity discoveries (if any)
- Boss escalation for any promote-to-execution candidates

**No probes, no execution, no capital movement without explicit
Boss ruling.**

---

## V4.1 rules that continue to apply

All V4.1 rules remain in force. Wave 10B does NOT supersede V4.1:

- **RULE 1** (Classify before integrate): tier system continues; new
  Executable Capacity concept SUPPLEMENTS, does not REPLACE
- **RULE 2** (Opportunity first): the entire spec is an expression of
  this rule
- **RULE 3** (Hard gates): class-specific gates in the Router extend
  V4.1's Gates A-D
- **RULE 4** (Lineage is a prior): unchanged
- **RULE 5** (Archives retain value): the Opportunity Router explicitly
  re-uses archived surface data for Classes G and H
- **RULE 6** (Capital protection): unchanged; capital LOCKED throughout
  all Wave 10B work

---

## Capital protection reaffirmation

Wave 10B does NOT touch capital deployment policy.

- **Wallet:** `0xd2eaa2B2E0c475e418B1682d321eD77558D1b5Fb`
- **Amount:** 0.042322364 ETH LOCKED (10+ waves untouched)
- **Execution:** LOCKED
- **Broadcast:** LOCKED
- **Armed surface:** Arbitrum ETH/USDC × Ramses V2 only (proven winner)
- **Smart contract:** ArbitrageBot at `0xD70d9f2245a23E3a4d07B2662029AD36f8dDa5a9`

Any surface promoted by the Opportunity Router to EXECUTION_READY
status still requires **explicit Boss ruling** before capital can
be armed for that surface. The Router computes; Boss decides.

---

## Success criteria for Wave 10B

Wave 10B is complete when:

1. All four scanner tracks (B, C, D, G) are implemented and running
   on existing Arbitrum surfaces
2. The Opportunity Router produces unified multi-class capability
   reports for every surface in the ledger
3. At least ONE new executable candidate emerges from Class B, C, D,
   or G analysis (or the Router formally reports "no new candidates
   found across the existing Arbitrum surface set")
4. The Executable Capacity metric is computed and displayed for
   every candidate surface × class combination

Failure modes that still count as success:

- Router runs cleanly but finds no new candidates → proves the
  framework works and existing Arbitrum surfaces are exhausted for
  the current opportunity classes; informs Wave 10C direction
- One or two classes produce candidates → each becomes a promote
  decision for Boss

---

## Cross-references

- Discovery Constitution V4.1: [DISCOVERY_CONSTITUTION_V4_1.md](DISCOVERY_CONSTITUTION_V4_1.md)
- Project ledger: [../project_ledger.md](../project_ledger.md)
- Research notebook: [../research/ramses_class_surface_characteristics.md](../research/ramses_class_surface_characteristics.md)
- Behavioral signature thesis: [../thesis/behavioral_signature.md](../thesis/behavioral_signature.md)
- Wave 10A Chronos archive (USDC.e migration data for Class G): [../archive/rejected_surfaces/chronos_v1_arbitrum/README.md](../archive/rejected_surfaces/chronos_v1_arbitrum/README.md)
- Wave 10A SolidLizard catalog (failed-launch pattern for Class G): [../archive/rejected_surfaces/solidlizard_arbitrum/README.md](../archive/rejected_surfaces/solidlizard_arbitrum/README.md)

## Version history

| Version | Date | Author | Change |
|---------|------|--------|--------|
| V1 | 2026-06-05 | Boss (design) + CPT (spec) | Initial Wave 10B kickoff spec locked; Surface Tier vs Executable Capacity refinement; Opportunity Router architecture; track sequence B → C → D → G |
