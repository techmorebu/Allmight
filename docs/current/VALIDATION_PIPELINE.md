# VALIDATION PIPELINE

Status: CURRENT  
Phase: Execution Scaling

---

## PIPELINE (LOCKED ORDER)

### 1. ACTIVATOR RUN

- Run system continuously
- Collect:
  - EXECUTION_READY signals
  - tick logs
  - depth + price behavior

Output:
- raw session data

---

### 2. REPLAY VALIDATION

- Ensure dense price_replay.jsonl
- Confirm:
  - no gaps
  - consistent timestamp spacing
  - both pools tracked

---

### 3. RPC BENCHMARK

- Run rpc_benchmark.js
- Evaluate:
  - latency
  - block freshness
  - failure rate

Apply:
- provider reordering
- fallback tuning

---

### 4. EXECUTION SANDBOX

- Run execution_sandbox.js
- Inputs:
  - replay data
  - size ladder
  - fee model

Test:
- 0ms delay
- 500ms delay
- 1000ms delay

---

### 5. REPORT GENERATION

- Run execution_sandbox_report.js

Output:
- net edge distribution
- decay vs delay
- survivability rate

---

### 6. SURFACE AUDIT

Classify:

- CONSISTENT_STRONG
- MARGINAL
- BLOCKED (fee/liquidity/slippage)

---

### 7. FLASH-LOAN FEASIBILITY

Evaluate:
- atomic viability
- gas burden
- slippage at scale

---

## FAILURE RULE

If any step fails:
→ STOP  
→ FIX  
→ RE-RUN

---

## FORBIDDEN

- skipping steps
- manual overrides
- assumptions without replay evidence
