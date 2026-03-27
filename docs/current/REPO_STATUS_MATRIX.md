# REPO STATUS MATRIX

<!-- STATUS: CURRENT | Last Reviewed: 2026-03-27 -->

Anti-confusion reference. Check here before touching anything.

| Area | Current Status | Authority Source | Action Required | Owner |
|---|---|---|---|---|
| Surface discovery | ACTIVE | session_handoff_2026-03-19.md | Continue -- find deeper ARB/USDC venue | CPT |
| Breakeven classification | ACTIVE | scripts/analysis/breakeven_engine.js | Add surfaces only, do not rewrite | CPT |
| Arbitrum fetcher | ACTIVE | arbitrumFetcher.js | Add pools with TOKEN-ORDER-GUARD only | CPT |
| Provider layer | ACTIVE | utils/provider_factory.js | Do not bypass or rewrite | Locked |
| Validators | ACTIVE | scripts/tools/ | Use as-is per validation pipeline | CPT |
| Ethereum mainnet | SECONDARY | provider_factory.js | Token registry issue pending | CPT |
| Fetcher fleet | ACTIVE_MIXED | session notes | Inspect before editing; label status | CPT |
| Execution engine | FROZEN | Boss ruling | Do not touch | Boss gate |
| Flash loan / contracts | FROZEN | Boss ruling | Do not touch | Boss gate |
| Phase 5-9 code | DORMANT | Historical phases | Preserve, do not activate | Preserve |
| Docs / appendices | MULTI-GEN | This reorg | Separating active vs archive | CPT |
| New chain expansion | FROZEN | Boss ruling | Arbitrum only for now | Boss gate |
| Surface inventory scanner | BUILT, PARKED | CPT session 2026-03-27 | Deploy after reorg complete | CPT |
