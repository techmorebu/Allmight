# G2.17 — Chain-Scoped DAI/USDC Comparison (FROZEN VERDICT)

Flash-loan model. $10k reference. Boss G2.17 accepted.

## Verdict: stable flash-loan arbitrage NOT viable at observed spread
  arbitrum:DAI/USDC:uni_camelot   margin -5.7 bps   surfaceScore 0
  ethereum:DAI/USDC:curve_uni     margin -8.9 bps   surfaceScore 0
  arbitrum:ETH/USDC:ramses_uni    margin +6.6 bps   surfaceScore 18.29 (reference)

## Cross-chain (cost): ARBITRUM cheaper at every size
  size    arbitrum be   ethereum be
  $1k      9.5 bp        32.5 bp
  $10k     7.7 bp        10.9 bp
  $100k    7.52 bp        8.74 bp

## Root cause: Aave 5bp flash fee dominates a ~2bp stable dislocation.
## Implication: stable arb is a balance-sheet game, not a flash-loan game.
## Next branch: inventory_mode_no_aave (separate economic model).

Tool: surface_score.js (margin-centric) | Execution: LOCKED | Capital: SAFE
