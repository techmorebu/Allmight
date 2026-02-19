# PROJECT ALLMIGHT — CURRENT STATE & NEXT BUILD ROADMAP

Updated: {datetime.utcnow().strftime("%Y-%m-%d %H:%M:%SZ")}
Status: CANONICAL (living roadmap; update via commits)
Governance: Determinism-first, JSONL canonical, measured gates before expansion.

---

## 0) One-Sentence Summary

We have built a deterministic, instrumented **Opportunity Qualification Pipeline** (validate → detect → preflight → route-sim), and the next required step is to connect it to **real market data** and generate one metrics report that proves (or disproves) survivable edge.

---

## 1) Where We Are Right Now (Phase Marker)

### ✅ Completed Subsystem: Opportunity Qualification Pipeline (2.4.x)
Pipeline:
**Market Data → Validation → Detection → Preflight → Route Simulation → Decision**
with **Telemetry + Metrics** at every stage.

What exists (high-level):
- **2.4.0 Instrumentation + Validation**
  - schema versioning, deterministic validator, contract tests
  - TELEMETRY_WARNING events
  - JSONL is canonical
- **2.4.1 Preflight**
  - deterministic accept/reject filter
  - canonical rejection taxonomy
  - safety buffer
- **2.4.2 Route Simulator**
  - V2 constant-product simulation (multi-hop)
  - deterministic sim outputs
- **Opportunity Detection v0**
  - cross-venue, same-pair candidate generation
  - feeds into preflight + sim

### ❌ Not Yet Proven (Reality Gap)
- Live market data flowing reliably
- Real rejection distributions over time
- Any evidence routes survive under real conditions
- Gas model sanity under volatility
- V3 simulation fidelity (if not implemented beyond V2)
- Bundle inclusion / MEV modeling
- Execution (paper/live)
- Capital allocation integration

---

## 2) The Clean Integration Rule (Ports)

To prevent spaghetti coupling, the rest of AllMight connects to this subsystem through **three hard junction points** only:

### Port A — QualifiedOpportunity Stream (QOS)
**Output:** only opportunities that survive gating (preflight/sim/bundle later).
**Consumers:** capital ladder, risk controller, execution adapters, strategy multiplexing.

### Port B — Policy Gate Interface
**Output:** what is allowed/forbidden; thresholds; sizing caps; SCAN_ONLY vs EXECUTION_ENABLED.
**Consumers:** preflight thresholds, venue/token allowlists, chain enablement, emergency stop.

### Port C — Receipts & Audit Ledger
**Output:** what happened, exactly (telemetry + later receipts).
**Consumers:** replay harness, validation evidence, incident tooling, performance attribution.

**Rule:** other modules MUST NOT call detectors directly. They consume QOS + Policy + Receipts.

---

## 3) The Remainder Roadmap (Phases + Gates)

### Phase RC-1 — Reality Check (LIVE DATA OBSERVATION)
**Goal:** connect to real data sources and observe the pipeline for 10–30 minutes.
**Deliverables:**
- Redis (or real fetchers) adapters → `MarketSnapshotV1`
- stage timings: FETCH/NORMALIZE/VALIDATE/WRITE
- run script (one-shot)
- **ONE metrics report**: detected → preflight pass → sim pass + breakdowns
**Gate:**
- ingestion stable, schema clean
- rejection reasons mostly explainable (not random parsing failures)
- either (a) some sim-ok survivors or (b) clear evidence of zero survivability and why

---

### Phase 2.4.2+ — Route Simulator Completion (V3)
**Goal:** simulation matches execution physics.
**Deliverables:**
- V3 bounded approximation (fast deterministic)
- V3 exact tick-walk (deterministic, cached tick tables)
- pool-state cache format keyed by (pool_id, block_ref)
**Gate:**
- deterministic results across runs
- V3 failures are “data missing” not “math broke”
- sim outputs include realized slippage + price impact reliably

---

### Phase 2.4.3 — Bundle Simulator (MEV-aware “would this land?”)
**Goal:** determine bundle eligibility before execution.
**Deliverables:**
- bundle builder model (dry first)
- Flashbots (or private relay) simulation
- gas coverage ratio + revert reasons
- telemetry: `BUNDLE_SIM_RESULT`
**Gate:**
- sim-ok candidates shrink to bundle-eligible candidates
- gas model bounded + measured (not optimistic)
- revert causes categorized deterministically

---

### Phase 2.4.4 — Minimal Executor (Guarded)
**Goal:** execution capability exists but remains gated.
**Deliverables:**
- stateless executor contract (if required)
- adapter interface: PaperAdapter + LiveAdapter (live disabled)
- idempotency + receipts
**Gate:**
- paper mode produces realistic receipts + PnL accounting
- live remains disabled behind explicit arming policy

---

### Phase 2.6 — Paper Trading + Calibration Loop
**Goal:** prove end-to-end without risking capital.
**Deliverables:**
- paper execution of bundle-eligible opportunities
- drift measurement: quoted vs realized
- tuning loop for safety buffer + gas bounds
**Gate (expansion gate):**
- CaptureRate ≥ 60% (paper-defined)
- RevertRate ≤ 10% (sim-defined)
- GasCoverageRatio ≥ 1.5
- 30 consecutive profitable (paper)

---

### Phase 2.7 — Selective Expansion (Edge-per-Integration-Cost)
**Goal:** expand markets only after pipeline is proven.
**Deliverables:**
- add Base/Arbitrum (SCAN_ONLY first)
- reuse same snapshot/preflight/sim pipeline
**Gate:**
- new chain ingestion stable
- similar rejection profile (healthy)
- some bundle-eligible opportunities appear

---

### Phase 3 — Capital Ladder + Risk Controller (ATM Brain)
**Goal:** decide sizing, throttles, and survival rules.
**Deliverables:**
- capital ladder notional sizing + daily caps
- risk penalty integration (regime affects thresholds and size)
- circuit breakers / cooldowns
**Gate:**
- system throttles itself based on risk and stability
- attribution exists (venue/pair/route profitability)

---

### Phase 4 — Strategy Multiplexing
**Goal:** multiple strategy families without cross-contamination.
**Deliverables:**
- separate budgets + risk lanes per strategy
- common output contract: QualifiedOpportunity only
**Gate:**
- one strategy cannot bankrupt another (budgets + kill-switches)

---

### Phase 5 — Live Arming (Production)
**Goal:** controlled transition to real execution.
**Deliverables:**
- arming policy ceremony (explicit operator steps)
- private execution only
- incident logging + kill switch
**Gate:**
- deterministic replay for incidents
- live adapter enabled only with signed/recorded policy + config hash

---

## 4) What’s Next (Immediate Focus)

**Next phase:** RC-1 Reality Check (live data observation)

Single objective:
- wire real feed → run 10–30 min → generate ONE report

No bundle sim until:
- live data produces consistent sim-ok candidates (or proves none survive)

---

## 5) Practical Checklist (Short)

### Must-build soon
- live ingestion adapters
- run script + one report
- V3 sim (approx → exact)
- bundle sim
- paper adapter + calibration
- capital ladder + risk controller
- live arming policy

### Optional later
- Postgres convenience layer (must be rebuildable from JSONL)
- dashboards/GUI
- cross-chain routing/bridges
- whale regime index
