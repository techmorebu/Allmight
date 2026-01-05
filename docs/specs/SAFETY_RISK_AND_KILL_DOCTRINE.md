# SAFETY, RISK, AND KILL DOCTRINE (AUTHORITATIVE)
Status: LOCKED

Prime directive:
This system must always be easier to STOP than to START.

============================================================
APPENDIX C — KILL-SWITCH & SAFETY DOCTRINE
============================================================

This system must always be easier to STOP than to START.

------------------------------------------------------------
PRIMARY KILL-SWITCHES (MANDATORY)
------------------------------------------------------------
- Global execution disable flag
- Per-lane execution disable
- Capital withdrawal freeze
- Network/API disconnect

------------------------------------------------------------
AUTOMATIC TRIGGERS
------------------------------------------------------------
- Max drawdown exceeded
- Replay divergence detected
- Unexpected regime transition
- API response anomalies
- Latency or data gaps

------------------------------------------------------------
DESIGN RULES
------------------------------------------------------------
- Kill-switch logic must be simple
- Kill-switch must not depend on AI
- Kill-switch must be testable offline
- Kill-switch overrides all automation

------------------------------------------------------------
PHILOSOPHY
------------------------------------------------------------
If a system cannot be stopped cleanly,
it is not intelligent — it is reckless.

------------------------------------------------------------

============================================================
APPENDIX F — FAILURE MODES & RECOVERY PLAYBOOK
============================================================

Failure is assumed. Survival is designed.

------------------------------------------------------------
COMMON FAILURE MODES
------------------------------------------------------------

1) DATA FAILURE
- Missing candles
- Corrupt feeds
- Replay divergence

Response:
→ Freeze execution
→ Switch to last known good snapshot
→ Require manual review

------------------------------------------------------------

2) STRATEGY FAILURE
- Unexpected drawdown
- False regime classification
- Overfitting detected

Response:
→ Reduce capital allocation
→ Disable lane
→ Log incident + tag strategy

------------------------------------------------------------

3) EXECUTION FAILURE
- Order rejection loops
- Slippage beyond tolerance
- API instability

Response:
→ Immediate lane shutdown
→ Cancel all open orders
→ Disconnect from venue

------------------------------------------------------------

4) SYSTEM FAILURE
- Process crash
- Node failure
- Resource exhaustion

Response:
→ Failover if available
→ Enter degraded mode
→ Preserve logs + state

------------------------------------------------------------

5) OPERATOR FAILURE
- Misconfiguration
- Manual override error
- Unauthorized change

Response:
→ Revoke permissions
→ Roll back config
→ Audit and lock system

------------------------------------------------------------
RECOVERY PRINCIPLES
------------------------------------------------------------
- Stop first, diagnose second
- Recovery must never require live trading
- Every failure improves the checklist

------------------------------------------------------------

============================================================
APPENDIX G — WHAT THIS SYSTEM WILL NEVER DO
============================================================

These are absolute constraints. They are not features waiting to be added.

------------------------------------------------------------
EXECUTION BOUNDARIES
------------------------------------------------------------
- Trade without explicit capital allocation
- Trade without a kill-switch
- Trade based solely on AI/LLM output
- Trade without replay verification

------------------------------------------------------------
INTELLIGENCE BOUNDARIES
------------------------------------------------------------
- Grant LLMs direct execution authority
- Allow self-modifying execution code
- Permit opaque decision paths

------------------------------------------------------------
RISK & ETHICS BOUNDARIES
------------------------------------------------------------
- Chase losses
- Override safety for performance
- Hide drawdowns or failures
- Depend on secrecy over robustness

------------------------------------------------------------
OPERATIONAL BOUNDARIES
------------------------------------------------------------
- Require constant human babysitting
- Depend on fragile infrastructure
- Scale before proving survivability

------------------------------------------------------------
FINAL RULE
------------------------------------------------------------
If a feature violates this appendix,
the feature is rejected — permanently.

------------------------------------------------------------

END OF APPENDICES E–G
============================================================

============================================================
APPENDIX I — DRAWDOWN MATHEMATICS & KILL THRESHOLDS
============================================================

Loss is inevitable. Ruin is optional.

------------------------------------------------------------
CORE DEFINITIONS
------------------------------------------------------------
Peak Equity (PE): Highest recorded equity value  
Current Equity (CE): Present equity value  

Drawdown (%) = (PE - CE) / PE * 100

------------------------------------------------------------
STANDARD THRESHOLDS (DEFAULTS)
------------------------------------------------------------

Per-Trade Loss:
- Hard cap: ≤ 1–2% of allocated lane capital

Daily Loss:
- Soft cap: 3%
- Hard cap: 5% → automatic lane shutdown

Cumulative Drawdown:
- Warning: 7–10%
- Hard Kill: 15–20% (lane disabled)

------------------------------------------------------------
KILL-SWITCH ESCALATION
------------------------------------------------------------

LEVEL 1 — WARN
- Capital reduced
- Execution frequency throttled

LEVEL 2 — FREEZE
- No new positions
- Existing positions closed safely

LEVEL 3 — KILL
- Lane disabled
- Manual review required
- No auto-restart allowed

------------------------------------------------------------
NON-NEGOTIABLE RULES
------------------------------------------------------------
- Loss limits are evaluated on realized + unrealized PnL
- Drawdown resets only after manual approval
- Recovery trading is forbidden

------------------------------------------------------------

============================================================
APPENDIX J — LEGAL / COMPLIANCE GUARDRAILS (US-FIRST)
============================================================

This appendix defines what AllMight is allowed to do
under a conservative U.S. regulatory interpretation.

This is a *risk-minimization* stance, not legal advice.

------------------------------------------------------------
CORE POSITIONING
------------------------------------------------------------
- AllMight is a personal / internal trading system
- No third-party funds are accepted
- No investment advice is provided
- No profit guarantees are implied

------------------------------------------------------------
TRADING & MARKET ACCESS
------------------------------------------------------------
Allowed:
- Trading own capital
- Using regulated exchanges where possible
- DeFi protocols accessed permissionlessly

Forbidden:
- Acting as a broker or custodian for others
- Pooling third-party capital
- Marketing strategies as “managed funds”

------------------------------------------------------------
AUTOMATION & AI
------------------------------------------------------------
Allowed:
- Automated execution of predefined strategies
- AI-assisted analysis (shadow / advisory)

Forbidden:
- Fully autonomous, self-modifying trading agents
- Black-box decision systems without auditability

------------------------------------------------------------
DATA & RECORDKEEPING
------------------------------------------------------------
Required:
- Retain logs of trades and decisions
- Preserve configuration history
- Ability to reconstruct actions post hoc

------------------------------------------------------------
TAX & REPORTING AWARENESS
------------------------------------------------------------
- Trades are taxable events
- Records must support cost basis reconstruction
- No attempt to conceal activity

------------------------------------------------------------
FINAL PRINCIPLE
------------------------------------------------------------
When uncertain, default to the more conservative,
transparent, and auditable interpretation.

------------------------------------------------------------

END OF APPENDICES H–J
============================================================
