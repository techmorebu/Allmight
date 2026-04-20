# PROJECT STATE CURRENT

Status: CURRENT  
Authority: April 19 Execution Handoff (Supersedes prior surface-discovery state)

---

## Current Phase
POST-VALIDATION → EXECUTION POLICY → SCALING

---

## Core Objective
Extract real, executable profit from validated surfaces through:

- RPC efficiency optimization
- Execution timing modeling (delay vs decay)
- Realistic execution simulation
- Flash-loan readiness (Band A surfaces)

---

## System Status

- Activator: LIVE (continuous surveillance)
- Tick Logger: ACTIVE (dense replay rows generated inline)
- Replay System: AVAILABLE (`price_replay.jsonl`)
- Execution Sandbox: AVAILABLE
- Breakeven Engine: STABLE
- Fetchers: MIXED STATE (not primary bottleneck)

---

## Core Insight (Locked)

Edge is not created by:
- new LP events
- random venue discovery

Edge appears when:
- price enters pre-positioned liquidity
- and execution friction is low enough to extract it

---

## Current Bottlenecks

1. RPC latency / routing inefficiency
2. Execution delay uncertainty
3. Premium endpoint overuse
4. Replay density validation (now largely resolved via tick logger)

---

## In Scope

- RPC benchmarking and routing optimization
- Execution timing model (0ms / 500ms / 1000ms delay analysis)
- Replay validation and density confirmation
- Execution sandbox analysis
- Flash-loan feasibility for Band A surfaces

---

## Out of Scope (STRICT)

- Strategy redesign
- Threshold changes
- Pipeline restructuring
- New indicators
- Broad chain expansion
- New system layers

---

## Locked System Flow

FETCHERS → REDIS → SCANNER → TIMESERIES → ACTIVATOR → (SIMULATION)

Execution exists only in simulation / evaluation mode.

---

## Current Truth

- The system works
- The edge exists conditionally
- The problem is extraction, not detection

---

## Next Build Target

Execution Efficiency Layer:
- minimize latency
- maximize viable capture window
- validate real execution survivability

---

## Rule

If it changes behavior, it is forbidden unless explicitly approved.
