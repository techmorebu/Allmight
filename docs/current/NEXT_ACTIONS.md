# NEXT ACTIONS

Status: CURRENT  
Authority: Execution Scaling Phase

---

## PRIMARY WORK QUEUE (ORDER IS LOCKED)

### 1. RPC OPTIMIZATION (FIRST PRIORITY)

Goal:
- Reduce latency
- Reduce premium endpoint reliance
- Improve freshness consistency

Tasks:
- Run rpc_benchmark.js
- Measure:
  - latency
  - block lag
  - failure rate
- Reorder provider priority
- Adjust cooldown / fallback behavior

---

### 2. EXECUTION TIMING MODEL

Goal:
Understand how delay affects real profitability.

Tasks:
- Validate replay density
- Use execution_sandbox.js
- Run delay sweeps:
  - 0ms
  - 500ms
  - 1000ms
- Generate execution_sandbox_report.js

Output:
- decay curves
- survivability thresholds

---

### 3. FLASH-LOAN READINESS (BAND A ONLY)

Goal:
Validate if top surfaces can support atomic execution.

Tasks:
- size scaling validation
- slippage confirmation
- gas cost modeling
- execution feasibility check

---

### 4. CONTROLLED EXPANSION (ONLY AFTER ABOVE COMPLETE)

Allowed only if:
- RPC stable
- timing model validated
- execution survivability proven

Then:
- expand pairs
- expand venues
- expand chains (Base → Optimism)

---

## FORBIDDEN WORK

- Adding new strategies
- Changing thresholds
- Refactoring pipeline
- Expanding blindly
- Rewriting working systems

---

## OPERATING RULE

Do not move to the next step until the current step produces measurable results.
