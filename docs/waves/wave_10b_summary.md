# Wave 10B Summary — Opportunity-class primitives + persistence + router

**Wave dates:** 2026-06-04 through 2026-06-05 (~1.5 days)
**Wave scope:** Analytical machinery, not surface discovery
**Wave verdict:** COMPLETE

Wave 10B built the analytical infrastructure for opportunity classes
A, B, C, D under Discovery Constitution V4.1, added a cross-class
persistence telemetry layer, and delivered a unified opportunity
router. Six commits plus one governance patch. Zero new surfaces
classified. Zero capital movement. All constitutional flags remain
false.

---

## Objective and constraint

Boss C9 opening objective (Wave 10B c1 authorization, 2026-06-04):

> Build economic primitives for opportunity classes underexplored by
> the surface-hunt research pattern. Do not add classes or scanners
> beyond what evidence justifies. Keep every primitive testable in
> isolation before composing them.

Constitutional constraint (unchanged from V4.1):

> Capital LOCKED. Broadcast LOCKED. Execution LOCKED. Proven Ramses
> surface UNTOUCHED. Analytics only until explicit Boss gate for any
> operational change.

---

## Commit chain

| # | Commit  | Title                                                 |
|---|---------|-------------------------------------------------------|
| 1 | `35864b3` | Borrowability registry — Aave V3 + Balancer V2       |
| 2 | `33e3830` | Class B (Flash Loan) financing overlay scanner v1     |
| 3 | `fea4def` | Class C (Triangular) closed-cycle scanner v1          |
| ✧ | `0325717` | docs(lessons): Pitfall 3 — pipefail + grep -q SIGPIPE |
| 4 | `38fbf92` | Class D (Stablecoin Basis) scanner v1                 |
| 5 | `28b73d7` | Cross-Class Persistence Telemetry v1                  |
| 6 | `7f37ba6` | Opportunity Router V1                                 |

---

## Primitive stack (architecture)

```
scripts/
├── scanners/                              (Wave 10B c2-c4)
│   ├── class_b_flash_loan.js              financing overlay for Class A arb
│   ├── class_c_triangular.js              closed-cycle scanner + bindingLeg
│   └── class_d_stablecoin_basis.js        basis + priceSanity + basisType
├── telemetry/                             (Wave 10B c5)
│   ├── opportunity_persistence.js         aggregator (durable)
│   └── fixtures/
│       ├── generate_v1.js                 deterministic corpus generator
│       └── observations_v1.jsonl          fixture corpus (240 records)
└── router/                                (Wave 10B c6)
    └── opportunity_router.js              unified routing decisions

config/
└── borrowability_registry.json            (Wave 10B c1)
```

### Data flow

```
DISCOVERY (pre-Wave-10B)
    │
    ▼
SURFACES (from V4.1 tier classification)
    │
    ▼
SCANNERS ──────► class_b, class_c, class_d canonical JSON outputs
    │
    ▼
PERSISTENCE ───► observation records → aggregator → surface summaries
    │
    ▼
ROUTER ────────► unified routing decisions per opportunity
    │
    ▼
(PLANNING) ────► future work: consumer of router output
    │
    ▼
(EXECUTION) ───► LOCKED — requires explicit Boss gate
```

---

## Boss C9 decisions that shaped Wave 10B

Key rulings in chronological order:

1. **Router track order (c1 authorization)** — B → C → D → G, then
   unified router. Boss reversed CPT's initial G-first proposal.
   Financing overlay established before opportunity discovery.

2. **c3 declarative legs schema (c3 authorization)** — router must
   consume generic `legs[]`, not hardcoded triangle. Enables future
   c3b enumeration without rewriting economics.

3. **c3 token-flow propagation** — track TOKEN AMOUNTS through cycle
   legs, not summed bps. Prevents unit-confusion in triangular math.

4. **Pitfall 3 governance (mid-wave patch)** — pipefail + grep -q
   SIGPIPE bug documented as governance lesson after recurring across
   c2 and c3 deploys. See
   `docs/lessons/deploy_script_pitfalls.md`.

5. **c4 sanity gate before profitability** — price sanity check runs
   BEFORE any profitability analysis. Chronos $4,757 ETH lesson from
   Wave 10A applied. basisType enum with 6 classifications
   (TEMPORARY_BASIS, MIGRATION_BASIS, LIQUIDITY_FAILURE, STALE_POOL,
   BROKEN_CURVE, REAL_DEPEG_RISK).

6. **c5 as telemetry layer, not scanner** — persistence measured
   through append-only observations with mandatory `candidate=false`
   records (frequency requires "nothing here" observations).
   captureProfile classified from OBSERVED ECONOMIC RUN LENGTH, not
   latency probabilities.

7. **c6 decisions not metadata** — router must emit routeDecision and
   priority, not just enriched fields. Fixture-derived decisions
   capped at WATCH via `telemetryConfidence = TEST_ONLY`, so synthetic
   data never becomes production policy.

8. **c6 lexicographic priority funnel** — no pseudo-EV math, no
   arbitrary dollar cutoffs. Reuses V4.1 surface tiers. Hit-rate bands
   as router constants (nonconstitutional, adjustable).

9. **Class A explicit in composition** — router formalizes `["A"]`,
   `["A","B"]`, `["C"]`, `["C","B"]`, `["D"]`, `["D","B"]`. Class B
   correctly behaves as financing modifier, not opportunity source.

10. **Atomicity and financing orthogonal** — captureProfile is
    independent of inventoryCapable / flashEligible / flashBeneficial.
    Flash loans solve capital availability, not atomicity.

---

## Key architectural principles established

### From c5

- **Persistence separate from instantaneous economics.** Scanner
  output is a snapshot; persistence output is a distribution over an
  observed window.
- **`candidate=false` observations are mandatory.** Frequency math
  requires "nothing here" records.
- **Latency survival buckets** 0, +1, +2, +5, +10 blocks — descriptive
  taxonomy, null when data insufficient.
- **Binding-constraint transitions are first-class telemetry** — a
  surface's bottleneck may evolve during an event.

### From c6

- **Router emits decisions with reasoning trails.** `routeReason` and
  `priorityBasis` are ordered lists auditable by downstream consumers.
- **Fixture vs live is architecturally enforced.**
  `telemetrySource ∈ {FIXTURE, REPLAY, LIVE}` × `telemetryConfidence
  ∈ {TEST_ONLY, LOW, MEDIUM, HIGH}`. Fixtures cap at WATCH by design.
- **captureProfile taxonomy over observed run length:**
  UNKNOWN_WINDOW, SAME_BLOCK_ONLY, SHORT_WINDOW, PERSISTENT_WINDOW.
  Persistent-window threshold is a nonconstitutional router constant.
- **priorityPolicyVersion + captureProfilePolicy fields** — future
  recalibration does not corrupt historical decisions.

---

## Constitutional invariants (unchanged)

- `executionAuthorized = false` on every scanner and router output.
- `broadcastAuthorized = false` throughout.
- `capitalMovement = false` throughout.
- Capital wallet
  `0xd2eaa2B2E0c475e418B1682d321eD77558D1b5Fb` (Arbitrum) —
  0.042322364 ETH, UNTOUCHED.
- Proven Ramses ETH/USDC surface — UNTOUCHED, LOCKED.
- Any operational promotion requires explicit Boss gate.

---

## Governance updates during the wave

- Discovery Constitution V4.1 — unchanged, but Wave 10B fully
  exercised the opportunity-class framework (RULE 2) via c2/c3/c4.
- `docs/lessons/deploy_script_pitfalls.md` — Pitfall 3 added
  (pipefail + grep -q SIGPIPE). Operating procedure item 5 added
  (prefer direct-file grep over pipe-based validation).
- No new lessons files, spec files, or archive additions.

---

## Wave 11 — the next constitutional objective

Boss C9 ruling (2026-06-05, post-c6 inspection):

> "Replace synthetic confidence with empirical confidence without
>  changing capital or execution posture."

Wave 11 sequence locked:

1. Wave 10B close-out ← this document
2. Live telemetry wiring (Wave 11 c1)
   - append real observations to `observations.jsonl`
   - `source = LIVE`
   - preserve negative observations
   - provenance: `telemetrySource`, `sourceProcess`, `sourceSchemaVersion`
   - temporal alignment: `observedBlock`, `sameBlockVerified`
3. Run c5 on real data (Wave 11 c2)
4. Run c6 on real telemetry (Wave 11 c3)
5. INSPECT results (Wave 11 close)
6. THEN choose direction (Class G, c3b, shadow integration, etc.)

Absolute invariant across Wave 11: `executionAuthorized = false`
remains until explicit Boss gate. Live telemetry raises analytical
confidence, not operational authorization.

---

## Cross-references

- Discovery Constitution V4.1: [`../specs/DISCOVERY_CONSTITUTION_V4_1.md`](../specs/DISCOVERY_CONSTITUTION_V4_1.md)
- Opportunity Router Spec V1: [`../specs/OPPORTUNITY_ROUTER_SPEC_V1.md`](../specs/OPPORTUNITY_ROUTER_SPEC_V1.md)
- Behavioral signature thesis: [`../thesis/behavioral_signature.md`](../thesis/behavioral_signature.md)
- Research notebook: [`../research/ramses_class_surface_characteristics.md`](../research/ramses_class_surface_characteristics.md)
- Project ledger: [`../project_ledger.md`](../project_ledger.md)
- Deploy pitfalls: [`../lessons/deploy_script_pitfalls.md`](../lessons/deploy_script_pitfalls.md)
- DEX contract discovery pitfalls: [`../lessons/dex_contract_discovery_pitfalls.md`](../lessons/dex_contract_discovery_pitfalls.md)
