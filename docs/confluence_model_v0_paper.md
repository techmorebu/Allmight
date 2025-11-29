# AllMight Confluence Model – v0 (Paper)

This document encodes the **macro regimes**, **asset structure states**, and the **Macro Confluence Score (MCS)** logic in a structured way, ready to be turned into code later.

---

## 1. Macro Regimes

| Regime            | Description                          | Typical DXY       | SPX/QQQ           | VIX              | Gold/Silver           | BTC/XRP                       |
|-------------------|--------------------------------------|-------------------|-------------------|------------------|-----------------------|-------------------------------|
| RISK_ON           | Risk assets favored                  | Flat / drifting   | Uptrend           | Low / declining  | Flat / mild bid       | Healthy trend / expansions    |
| RISK_OFF_SOFT     | Mild caution                         | Slowly rising     | Choppy / pullback | Elevated         | Mild bid              | Choppy, wicks both sides      |
| RISK_OFF_STRONG   | Defensive posture                    | Strong uptrend    | Clear downtrend   | High             | Strong bid            | Breaking key structure levels |
| PANIC             | Crisis / disorderly repricing        | Spikes / disorder | Crash conditions  | Extreme spike    | Vertical moves        | Extreme liquidations / shocks |

> In Phase 0, exact numeric boundaries (e.g. VIX > 30) should be defined in a companion sheet.

---

## 2. Core 6 Asset Structure States

Assets:
- Gold (XAU)
- Silver (XAG)
- SPX (or QQQ)
- BTC
- ETH
- XRP

States:
- **ACCUMULATION**
- **EXPANSION**
- **DISTRIBUTION**
- **MARKDOWN**

### 2.1 General Definitions

| State         | Description                                                                 |
|---------------|-----------------------------------------------------------------------------|
| ACCUMULATION  | Sideways ranges after down moves; failed breakdowns; absorption of supply. |
| EXPANSION     | Strong trend move away from a prior accumulation range.                    |
| DISTRIBUTION  | Sideways ranges after up moves; failed breakouts; topping behavior.       |
| MARKDOWN      | Persistent lower lows after distribution; impulsive downtrends.            |

### 2.2 Example Bias Mapping (Template)

For each asset, we define bias as LONG / SHORT / NEUTRAL depending on state + macro regime.

Example template (to be adapted per asset):

| Asset | State         | Macro Regime      | Bias       | Notes                                  |
|-------|---------------|-------------------|------------|----------------------------------------|
| BTC   | ACCUMULATION  | RISK_ON           | LONG       | Accumulate spot / directional longs    |
| BTC   | ACCUMULATION  | RISK_OFF_STRONG   | NEUTRAL    | Only arb; no new directional risk      |
| BTC   | EXPANSION     | RISK_ON           | LONG       | Trend-following allowed                |
| BTC   | DISTRIBUTION  | Any               | NEUTRAL    | Reduce risk, wait for clarity          |
| BTC   | MARKDOWN      | Any               | SHORT/FLAT | Hedge / avoid long directionals        |

Phase 0 Task:
- Fill a table like this for each of the Core 6 assets.

---

## 3. Macro Confluence Score (MCS)

The MCS is a scalar score used to decide how aggressively the engine can participate.

### 3.1 Suggested Components

1. Macro Regime Base Score

| Regime            | Base Score |
|-------------------|-----------:|
| RISK_ON           |        +10 |
| RISK_OFF_SOFT     |         +5 |
| RISK_OFF_STRONG   |         +1 |
| PANIC             |         -5 |

2. Asset Structure Contribution  
   - For each asset in Core 6:
     - EXPANSION in aligned direction: +2
     - ACCUMULATION in aligned regime: +1
     - DISTRIBUTION: 0
     - MARKDOWN against risk sentiment: -2

3. Execution Constraints
   - Liquidity / spreads / slippage:
     - Good conditions: +0 to +3
     - Poor conditions: -1 to -3

### 3.2 Thresholds

| MCS Range  | Allowed Behavior                             |
|-----------:|-----------------------------------------------|
| MCS < 15   | No directionals, arbitrage-only, smaller size |
| 15–21      | Small directional positions allowed           |
| ≥ 22       | Full strategy activation (subject to risk caps)|

Phase 0 Task:
- Build a simple calculator (sheet or script-later) that:
  - Inputs: regime, per-asset state, liquidity conditions
  - Output: MCS number + allowed risk tier.

---

## 4. Execution Brain – Venue & Edge Rules (Paper)

For each chain/venue:

| Chain     | Venue      | Min Net Edge (%) | Max Slippage (%) | Max Position Size (notional) | Notes                                            |
|-----------|------------|------------------|------------------|------------------------------|--------------------------------------------------|
| Ethereum  | Uniswap V3 | 1.0              | 0.5              | Config TBD                   | Used for arb / routing                           |
| Base      | DEX_X      | 0.8              | 0.5              | Config TBD                   | L2 cheap gas; potential small spread capture     |
| CEX_A     | Spot       | 0.5              | N/A              | Config TBD                   | Fiat on/off, centralized risk consideration      |

Phase 0 Task:
- Populate this table with your actual intended venues & thresholds.

---

## 5. How This Connects to Data (Later Phases)

Later, the MCS & structure logic will read from:

- Price and OHLC data (CEX/DEX)
- Macro data feeds (DXY, VIX, yields, metals)
- On-chain state (for some DeFi-specific signals)

In Phase 0:
- The focus is on the **rules**, not the live data.
- Data schemas discovered by `universal-field-mapper.js` tell us **what fields we can use** later to compute states and scores.

---
