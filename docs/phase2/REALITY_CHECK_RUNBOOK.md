# REALITY CHECK RUNBOOK - Phase 2.6

**Status:** READY TO IMPLEMENT  
**Goal:** Wire real Redis → Pipeline → One honest report  
**Duration:** 10-30 minutes of live data  
**Expected:** Brutal honesty about what survives

---

## Objective

Run the pipeline on **real market data** and produce **one metrics report** that answers:
- How many opportunities detected?
- How many pass preflight?
- How many survive simulation?
- Is the gas model realistic or fantasy?
- Do ANY routes show positive net edge?

**No execution. No bundles. Pure observation.**

---

## Expected Outcomes (So You Don't Panic)

**Most likely results:**
- Detected: **hundreds**
- Preflight accept: **< 5%**
- Sim ok & net positive: **0-3**
- Lots of `NETEDGE_BELOW_BUFFER` rejections

**If 0 survive:** GOOD. The filters are honest. Analyze:
- Are rejections mostly `NETEDGE_BELOW_BUFFER` vs `GAS_TOO_HIGH` vs `SLIPPAGE_TOO_HIGH`?
- If gas: model too pessimistic OR tier too small
- If slippage: scanning shallow pools
- If netedge: market efficient for these pairs/venues

**If some survive:** Don't celebrate. Inspect manually. Re-run to verify persistence.

---

## Implementation Tasks

### Task 1: Define Redis Intake Contract

**Create:** `scripts/market/redis_intake_schema.md`

Document for each fetcher:
- Redis key pattern(s)
- Data format (JSON string? hash fields?)
- Available fields: prices, liquidity/reserves, fees, block, timestamp
- Field mapping to internal schema

### Task 2: Internal Schema - RawMarketState

Before MarketSnapshotV1, normalize into:

```python
@dataclass
class RawMarketState:
    """Normalized market state from any source"""
    chain_id: str
    venue_id: str
    market_id: str
    ts_ms: int
    block_ref: int  # 0 if missing (log warning)
    
    # Tier prices
    buy_px_1k: Optional[float]
    sell_px_1k: Optional[float]
    buy_px_5k: Optional[float]
    sell_px_5k: Optional[float]
    buy_px_10k: Optional[float]
    sell_px_10k: Optional[float]
    
    mid_px: float
    
    # Slippage (compute proxy if missing)
    slippage_bps_1k: Optional[float]
    slippage_bps_5k: Optional[float]
    slippage_bps_10k: Optional[float]
    
    swap_fee_bps: float
    
    # Pool state for simulator
    pool_state: Optional[Dict]  # Reserves for V2, slot0/liquidity for V3
```

### Task 3: Redis Adapters

**Create:**
- `scripts/market/redis_adapters/__init__.py`
- `scripts/market/redis_adapters/uniswap_v3.py`
- `scripts/market/redis_adapters/sushiswap_v2.py`

Each adapter:
1. Read Redis payload
2. Parse
3. Map fields → RawMarketState
4. Emit TELEMETRY_WARNING if fields missing/defaulted
5. Return `RawMarketState | None`

**Key rule:** Missing critical fields → return None (don't poison pipeline)

### Task 4: Update Snapshot Collector

Update `snapshot_collector.py`:
1. Call adapters for N markets (start with allowlist)
2. Convert RawMarketState → MarketSnapshotV1
3. Use structured validator
4. Only write if validation ok
5. Emit stage timings:
   - FETCH_REDIS
   - NORMALIZE
   - VALIDATE
   - WRITE_SNAPSHOT

**Output:** `data/market_snapshots/YYYYMMDD/snapshots.jsonl`

### Task 5: Opportunity Detector v0 - Production

**Cross-venue same-pair only:**
- Same chain_id
- Same base/quote token
- Buy venue A, sell venue B
- Tier 1000 only (reduce noise)

Emit telemetry: OPPORTUNITY_DETECTED

### Task 6: Wire Preflight → Simulator

**V2 routes only** for first run:
- Sushi/UniV2-style (stable simulator)
- V3 data can be detected but will fail simulation (that's informative)

Pipeline per candidate:
1. `preflight_check(...)`
2. If `ACCEPT_*`, run `simulate_route(...)`
3. Log sim result
4. Classify "survived" if `ok and net_edge > buffer`

### Task 7: Run Command

**Create:** `scripts/run_reality_check.py`

Arguments:
- `--minutes 10`
- `--venues uniswap_v3,sushiswap`
- `--tier 1000`
- `--max-markets 50` (start small)
- `--redis-url ...`

Output:
- Snapshots ingested count
- Opportunities detected count
- Preflight pass rate
- Sim pass rate
- Top 10 rejection codes
- Top 10 sim failure codes

### Task 8: Reality Check Report

**Create:** `reports/reality_check/YYYYMMDD_HHMM_report.txt`

Include:
- Counts + rates
- Rejection breakdown
- Sim failure breakdown
- Net edge histogram (min/avg/p95)
- Gas model sanity section:
  - Avg gas_bps_est at tier=1000
  - Max gas_bps_est
  - % rejected by GAS_TOO_HIGH

---

## Hard Rules

1. **No bundle simulator (2.4.3) until we can produce "sim-ok candidates" from live data**
2. **No celebration if routes survive - inspect manually first**
3. **0 survivors is GOOD DATA - it means filters are honest**
4. **Focus on observation, not optimization**

---

## Success Criteria

**Session is successful if we can answer:**
- ✅ How many real opportunities exist?
- ✅ What percentage pass preflight?
- ✅ What percentage survive simulation?
- ✅ What are the actual rejection patterns?
- ✅ Is our gas model realistic?

**The number of survivors doesn't matter. The data quality matters.**

---

## What Happens Next

**If analysis reveals:**
- Gas too high: Adjust gas model OR increase tier
- Slippage too high: Filter for deeper pools
- Net edge below buffer: Expand venues/pairs OR tighten thresholds
- Everything gets rejected: Market is efficient (valuable knowledge!)

**Then and only then:** Consider bundle simulator or execution logic.

---

**Next session starts here. No detours. Lab → Reality → Truth.**

---

**Version:** 1.0  
**Date:** 2026-02-19  
**Status:** READY FOR IMPLEMENTATION
