# Market Inefficiency Profiler - Usage Guide

## 🎯 What This Does

The **Market Inefficiency Profiler** proves whether exploitable edge exists in your current 14 markets BEFORE expanding to 150+ markets.

It answers the critical question: **"Should we expand, or optimize what we have?"**

---

## 📦 Files Overview

### Core System (MarketSnapshot V1)
1. **market_types.py** - Enums and type definitions
2. **market_snapshot.py** - The canonical snapshot format (THE SPINE)
3. **market_validate.py** - Invariant enforcement
4. **market_adapter.py** - Plugin interface for DEXs/chains
5. **market_storage.py** - Deterministic JSONL storage

### Profiler System
6. **snapshot_collector.py** - Collects real data from your existing fetchers
7. **market_profiler.py** - Analyzes snapshots, computes EdgeScores
8. **profiler_runner.py** - Main script, generates expansion report

---

## 🚀 Quick Start

### Step 1: Install Files
```bash
cd ~/Allmight/scripts

# Create market module directory
mkdir -p market
cp ~/Downloads/market_*.py market/
cp ~/Downloads/snapshot_collector.py .
cp ~/Downloads/profiler_runner.py .

# Make executable
chmod +x snapshot_collector.py profiler_runner.py
```

### Step 2: Collect Data (Run for 1-2 hours)
```bash
# Collect snapshots every 60 seconds for 60 minutes
python3 snapshot_collector.py --mode continuous --duration 60 --interval 60

# Or run in background
nohup python3 snapshot_collector.py --mode continuous --duration 120 &
```

**What it does:**
- Reads from Redis (your existing uniswapV3Fetcher, sushiswapFetcher)
- Converts to MarketSnapshot format
- Stores in `data/snapshots/{chain}/{venue}/{market}/{date}.jsonl`
- Collects ~60-120 snapshots per market

### Step 3: Analyze & Get Report
```bash
# Analyze last 1 hour of data
python3 profiler_runner.py --hours 1

# Or analyze last 2 hours
python3 profiler_runner.py --hours 2

# Save report to file
python3 profiler_runner.py --hours 1 --output profiler_report.txt
```

---

## 📊 Understanding the Report

### EdgeScore Interpretation

The profiler computes an **EdgeScore (0-10)** for each market:

```
EdgeScore = Weighted(Spread, Persistence, Frequency, Slippage, Depth)

Weights:
- Spread: 30% (how big is the opportunity?)
- Persistence: 25% (how long does it last?)
- Frequency: 20% (how often does it appear?)
- Slippage: 15% (can notional survive?)
- Depth: 10% (is there liquidity?)
```

### Status Categories

- **STRONG** (score ≥8.0): Excellent edge, definitely execute
- **VIABLE** (score 4.0-8.0): Worth executing on
- **WEAK** (score 1.0-4.0): Marginal, optimize first
- **NONE** (score <1.0): No exploitable edge

### Example Report Output

```
🔬 MARKET INEFFICIENCY PROFILER REPORT
============================================================

📊 SUMMARY:
   Total markets analyzed: 14
   STRONG edge (score ≥8.0): 3
   VIABLE edge (score 4.0-8.0): 5
   WEAK edge (score 1.0-4.0): 4
   NO edge (score <1.0): 2

✅ Edge exists! Proceed with expansion to similar markets

============================================================
📈 DETAILED MARKET RANKINGS
============================================================

Market                   | AvgSpread | 95p Spread | Persist(ms) | Slip@5k | EdgeScore | Status
ETH/USDC (Cross-DEX)     |    61.2   |   120.5    |    2100     |   25.3  |    8.5    | STRONG
WBTC/ETH (Uniswap)       |    45.8   |    89.2    |    1500     |   18.2  |    6.2    | VIABLE
...

============================================================
💡 RECOMMENDATIONS
============================================================

1. STRONG markets found - these are your moneymakers!
   Focus: ETH/USDC (Cross-DEX), WBTC/ETH, DAI/USDC

2. VIABLE markets - worth executing on
   Execute: LINK/ETH, UNI/ETH, AAVE/ETH

🚀 EXPANSION GUIDANCE:
   Best performing venue: Cross-DEX
   Best performing pair: ETH/USDC

   ✅ Expand to Base/Arbitrum with similar pairs
```

---

## 🎯 Decision Tree

### Scenario A: 3+ STRONG Markets
```
✅ EXPAND
Target: Base, Arbitrum, Avalanche
Focus: Same pairs that show STRONG edge
Reason: Proven edge exists, scale to similar markets
```

### Scenario B: 1-2 STRONG + VIABLE Markets
```
⚠️  SELECTIVE EXPANSION
Target: Base, Arbitrum only
Focus: Best performing pairs
Reason: Some edge exists, proceed cautiously
```

### Scenario C: Only WEAK Markets
```
❌ DO NOT EXPAND
Action: Optimize execution layer first
Reason: Marginal edge won't survive expansion overhead
```

### Scenario D: NO Edge
```
❌ DO NOT EXPAND
Action: Focus on Phase 2.4 (Execution Layer)
Reason: No exploitable edge - expansion multiplies noise
```

---

## 🔧 Advanced Usage

### Collect More Frequently
```bash
# Every 30 seconds for 2 hours
python3 snapshot_collector.py --mode continuous --duration 120 --interval 30
```

### Analyze Specific Time Range
```python
from profiler_runner import ProfilerRunner

runner = ProfilerRunner()
profiles = runner.analyze_recent(hours=2)  # Last 2 hours
report = runner.generate_report(profiles)
print(report)
```

### Get Machine-Readable Decision
```bash
python3 profiler_runner.py --hours 1 --json
```

Output:
```json
{
  "should_expand": true,
  "expand_to": ["base", "arbitrum", "avalanche"],
  "focus_pairs": ["ETH/USDC", "WBTC/ETH", "DAI/USDC"],
  "reason": "Found 3 STRONG markets - excellent edge exists"
}
```

---

## 📁 Data Storage Structure

```
data/
└── snapshots/
    └── eth/
        ├── uniswapV3Fetcher/
        │   ├── ETH_USDC/
        │   │   ├── 2026-02-13.jsonl
        │   │   └── 2026-02-14.jsonl
        │   └── WBTC_ETH/
        │       └── 2026-02-13.jsonl
        └── sushiswapFetcher/
            └── ETH_USDC/
                └── 2026-02-13.jsonl
```

Each `.jsonl` file contains one snapshot per line (deterministic, append-only).

---

## 🛡️ Invariants & Safety

The system enforces these invariants:

1. **Non-negative prices** - All prices must be ≥0
2. **Tiered price sanity** - Buy prices increase with size, sell prices decrease
3. **Spread exists** - buy_px ≥ sell_px (violations flagged as anomalies)
4. **Stable market_id** - Market IDs don't change over time
5. **Deterministic serialization** - Same snapshot always produces same JSON

**Violations are logged and rejected** - bad data never enters the profiler.

---

## 🔍 Troubleshooting

### "No snapshots collected"
- Check Redis is running: `redis-cli ping`
- Check fetchers are running: `redis-cli keys "fetcher:*"`
- Check fetcher data exists: `redis-cli get fetcher:uniswapV3Fetcher`

### "No profiles generated"
- Make sure you collected data first (Step 2)
- Check data directory: `ls -la data/snapshots/`
- Verify snapshots exist: `cat data/snapshots/eth/uniswapV3Fetcher/*/2026-*.jsonl | wc -l`

### "Too few snapshots"
- Need at least 5 snapshots per market to profile
- Increase collection duration or decrease interval

---

## 📈 What's Next?

Based on profiler results:

### If Edge Exists → Phase 2.3B (EVM L2 Expansion)
- Add Base, Arbitrum, Avalanche
- Focus on pairs with STRONG EdgeScores
- Target 60-80 quality markets

### If No Edge → Phase 2.4 (Execution Layer)
- Build flash loan integration
- Optimize gas/slippage
- MEV protection
- Focus on capturing the few opportunities that exist

---

## 🎓 Key Insights

> "If your current stack cannot extract repeatable positive NetEdge... adding 150 markets just multiplies noise."

The profiler is **NOT** about maximizing opportunity count.

It's about **proving edge exists** before expanding.

**No ego deployments. No hope-driven expansion. Just measured, surgical growth.**

---

## 📝 Example Workflow

```bash
# 1. Start collection (run for 1-2 hours)
python3 snapshot_collector.py --mode continuous --duration 120 &

# 2. Monitor collection
tail -f nohup.out

# 3. After 1-2 hours, analyze
python3 profiler_runner.py --hours 2 --output expansion_report.txt

# 4. Read report
cat expansion_report.txt

# 5. Make data-driven decision
# - If STRONG edge → Expand (Phase 2.3B)
# - If no edge → Execution layer (Phase 2.4)
```

---

## ✅ Success Criteria

Phase 2.3A is complete when:

1. ✅ MarketSnapshot V1 can represent all 14 current markets
2. ✅ Snapshots collected for 1-2 hours
3. ✅ EdgeScore computed for each market
4. ✅ Expansion report generated
5. ✅ Data-driven decision made (expand or not)

**No guessing. Just data.**
