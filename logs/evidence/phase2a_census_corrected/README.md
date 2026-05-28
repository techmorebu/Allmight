# Phase 2A Census — CORRECTED (chain-scoped)

Chain-aware census (surface_telemetry_audit.js v1.1). Supersedes the
pre-chain-scoping baseline in logs/evidence/phase2a_census/ which had
cross-chain pair-level aggregation artifacts (Boss Ruling B).

## Key correction
Curve (stable-swap) for stable pairs is on ETHEREUM, not Arbitrum:
- arbitrum:DAI/USDC observed: uniswap_v3, camelot_v3 (NO curve)
- ethereum:DAI/USDC observed: uniswap_v3, curve
The global aggregation had conflated them. Chain-scoping separated them,
preventing a false strategy assumption from becoming config drift.

## Snapshot
- 12 fetchers / 6 chains / 25 observed chain:pairs
- FULL: arbitrum:ETH/USDC (arbitrum venues only — no cross-chain leak)
- PARTIAL: arbitrum:DAI/USDC, arbitrum:ETH/USDT, arbitrum:ARB/USDC

## Boss ruling acted on
Option 3: configure arbitrum:DAI/USDC:uni_camelot AND ethereum:DAI/USDC:curve_uni;
let the scorer decide which structure wins after fee-floor margin.

## Status
Tool: surface_telemetry_audit.js v1.1 | Live trading: LOCKED | Capital: SAFE
