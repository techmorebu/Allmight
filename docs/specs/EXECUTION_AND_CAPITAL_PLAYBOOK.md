# EXECUTION AND CAPITAL PLAYBOOK (AUTHORITATIVE)
Status: GOVERNED (patch-only changes)

Execution is a privilege.
No lane may touch capital without:
- a written lane spec
- kill-switch verification
- drawdown thresholds configured

============================================================
APPENDIX D — CAPITAL FLOW DIAGRAMS (TEXT-FIRST)
============================================================

These diagrams describe capital movement using text primitives.
No flow may be implicit.

------------------------------------------------------------
BASE CAPITAL FLOW
------------------------------------------------------------
[ Capital Pool ]
      |
      v
[ Strategy Allocation ]
      |
      v
[ Execution Lane ]
      |
      v
[ Profit / Loss ]
      |
      +--> [ Loss → Shutdown / Reduce ]
      |
      +--> [ Profit → Vault Routing ]

------------------------------------------------------------
VAULT ROUTING MODEL
------------------------------------------------------------
[ Profit ]
   |
   +--> [ Operating Vault ]
   |
   +--> [ Compounding Vault ]
   |
   +--> [ Reserve / Safety Vault ]
   |
   +--> [ Hardware / R&D Vault ]

------------------------------------------------------------
DRAWNDOWN RESPONSE
------------------------------------------------------------
[ Drawdown Trigger ]
        |
        v
[ Capital Reduction ]
        |
        v
[ Lane Shutdown ]
        |
        v
[ Manual Review Required ]

------------------------------------------------------------
HARD RULE
------------------------------------------------------------
Capital never loops without passing through a vault decision.

------------------------------------------------------------

END OF APPENDICES B–D
============================================================

============================================================
APPENDIX E — EXECUTION LANE SPECIFICATION TEMPLATE
============================================================

Every execution lane MUST be defined using this template
before it is allowed to touch capital.

No deviations. No shortcuts.

------------------------------------------------------------
EXECUTION LANE METADATA
------------------------------------------------------------
Lane ID:
Lane Type: (Single-Asset / Grid / Arbitrage / Yield / Other)
Associated Phase:
Creation Date:
Owner / Operator:
Status: (Proposed / Shadow / Active / Disabled)

------------------------------------------------------------
CAPITAL PARAMETERS
------------------------------------------------------------
Initial Capital Allocation:
Maximum Capital Allocation:
Capital Source Vault:
Profit Destination Vault(s):
Loss Absorption Vault:

------------------------------------------------------------
RISK CONSTRAINTS
------------------------------------------------------------
Max Loss per Trade:
Max Loss per Day:
Max Drawdown (%):
Position Size Rules:
Leverage Allowed: (Yes / No — specify)

------------------------------------------------------------
EXECUTION RULES
------------------------------------------------------------
Execution Frequency:
Order Types Allowed:
Slippage Limits:
Latency Tolerance:
Markets / Venues Allowed:

------------------------------------------------------------
AUTOMATIC SHUTDOWN TRIGGERS
------------------------------------------------------------
[ ] Max drawdown breached
[ ] Unexpected regime transition
[ ] Data integrity failure
[ ] Latency anomaly
[ ] Manual operator trigger

------------------------------------------------------------
OBSERVABILITY & AUDIT
------------------------------------------------------------
Logging Enabled: (Yes / No)
Metrics Recorded:
Replay Compatibility Verified: (Yes / No)

------------------------------------------------------------
FINAL AUTHORIZATION
------------------------------------------------------------
Reviewed By:
Approval Date:
Kill-Switch Test Verified: (Yes / No)

------------------------------------------------------------

============================================================
APPENDIX H — REGIME CLASSIFICATION TRUTH TABLE
============================================================

This appendix defines how market regimes are classified.
Regimes are descriptive states — NOT trade commands.

No execution logic may bypass this layer.

------------------------------------------------------------
PRIMARY REGIME AXES
------------------------------------------------------------
Axis 1: Structure
- Trending
- Ranging
- Broken / Dislocated

Axis 2: Volatility
- Low
- Normal
- Elevated
- Extreme

Axis 3: Liquidity / Participation
- Healthy
- Thinning
- Fragmented

------------------------------------------------------------
REGIME TRUTH TABLE (SIMPLIFIED)
------------------------------------------------------------

STRUCTURE   | VOLATILITY | LIQUIDITY   | REGIME LABEL
------------|------------|-------------|-------------------------
Trending   | Low/Normal  | Healthy     | RISK-ON
Trending   | Elevated    | Thinning    | RISK-ON (CAUTION)
Ranging    | Low         | Healthy     | NEUTRAL
Ranging    | Elevated    | Thinning    | RISK-OFF (SOFT)
Broken     | Elevated    | Fragmented  | RISK-OFF (HARD)
Any        | Extreme     | Fragmented  | PANIC

------------------------------------------------------------
HARD RULES
------------------------------------------------------------
- Regime changes do NOT trigger trades directly
- Regime disagreement defaults to the more conservative state
- PANIC overrides all other regime interpretations

------------------------------------------------------------
OUTPUT CONTRACT
------------------------------------------------------------
Each regime output must include:
- Regime label
- Confidence score
- Supporting metrics snapshot
- Replay window ID

------------------------------------------------------------
