# CANONICAL_SURFACE

**Status:** LOCKED  
**Boss ruling:** 2026-05-07 (operational baseline freeze)  
**Last verified:** 2026-05-07 (system_integrity_audit.sh PASS)

---

## Single source of truth

Every component of AllMight in Phase 3 operates against exactly one trading surface. That surface is:

```
PRIMARY SURFACE         ETH/USDC-RAMSES
PAIR_CONFIG KEY         "ETH/USDC-RAMSES"
ACTIVATOR --pair        ETH/USDC-RAMSES
EXECUTOR ADDRESS        0xd2eaa2B2E0c475e418B1682d321eD77558D1b5Fb
```

## Pool topology

```
CHAIN                   Arbitrum One (chainId 42161)
PRICING POOL (UniV3)    0x6f38e884725a116C9C7fBF208e79FE8828a2595F  (0.01% fee)
EXECUTION POOL (Ramses) 0x30AFBcF9458c3131A6d051C621E307E6278E4110  (0.05% fee)
TOKEN0 (WETH)           0x82aF49447D8a07e3bd95BD0d56f35241523fBab1
TOKEN1 (USDC native)    0xaf88d065e77c8cC2239327C5EDb3A432268e5831
TICK_SPACING            1 (UniV3 0.01% pool is the tick-map source)
```

## Why this surface, not another

ETH/USDC-RAMSES is classified `CANDIDATE (STRUCTURAL)` per the surface inventory:
- **Venue inertia confirmed** — Ramses V2 reprices slower than UniV3 / Camelot
- **73% positive scan rate** across discovery scans
- **Mean net spread +0.041%** (post-friction, after-fees)
- **Peak observed spread at dislocation:** +0.097% (historical), 0.277% (2026-05-07)
- **Deployed executor matches this exact pool** (Ramses V2 0.05% pool 0x30AF...)

ARB/USDC, ETH/USDT, DAI/USDC, SushiSwap V3, and Ramses V2 on Ethereum mainnet are **WATCHLIST**, not active.

## What "locked" means

The following are NOT changeable without an explicit Boss ruling:

- The `PRIMARY SURFACE` field above
- The activator's `--pair=ETH/USDC-RAMSES` flag in `scripts/tools/start_all.sh`
- The deployed executor's pool/token pins
- The surface key referenced in `micro_live_oneshot.js` and other consumers

## Boss approval required for

```
✘ Adding a parallel surface (multi-surface live execution)
✘ Switching the primary surface
✘ Redeploying the executor against a different pool
✘ Loosening the surface lock to allow runtime selection
✘ Removing the --pair flag from start_all.sh
```

CPT cannot self-authorize any of the above, even if testing or research suggests benefit.

## Observed history of drift (lesson)

Between session_20260414_0728 and session_20260506_0031 (~3 weeks), the activator silently ran on `ARB/USDC` while the deployed executor was for `ETH/USDC-RAMSES`. This was caught by the pre-rehearsal audit on 2026-05-07. The corrections (Boss ruling A1 + B1 + B2) restored alignment.

This file exists to prevent that pattern from recurring. The pre-rehearsal audit (`scripts/tools/audit_rehearsal_wiring.sh`) and system integrity audit (`scripts/tools/system_integrity_audit.sh`) verify the activator's pair against this canonical surface on every run.

## Verification

To confirm the system is operating on the canonical surface:

```bash
# Activator process should include --pair=ETH/USDC-RAMSES
ps -ef | grep arb_window_activator | grep -v grep

# Executor at the canonical address should have bytecode
node -e "
require('dotenv').config();
const { ethers } = require('ethers');
const p = new ethers.JsonRpcProvider(process.env.ARBITRUM_MAINNET_RPC_URL_2);
p.getCode('0xd2eaa2B2E0c475e418B1682d321eD77558D1b5Fb')
  .then(c => console.log(c === '0x' ? 'MISSING' : 'OK (' + (c.length/2-1) + ' bytes)'));
"

# Recent activator records should declare the canonical pair
grep -oE '"pair":"[A-Z]+/[A-Z]+(-[A-Z]+)?"' \
  logs/sessions/session_$(cat logs/allmight.session)/activator.jsonl \
  | sort | uniq -c | tail -5
# Expected: ETH/USDC-RAMSES (and ONLY this)
```

If any of the above shows a mismatch, **stop all live and rehearsal activity** and escalate to Boss.

---

## References

- Boss ruling 2026-05-07 (A1 — pair retarget)
- Boss ruling 2026-04-04 (Ramses V2 surface promotion)
- Boss ruling 2026-04-10 (size policy: $200 execution-validated for ETH/USDC-RAMSES)
- `scripts/analysis/arb_window_activator.js` — `PAIR_CONFIGS["ETH/USDC-RAMSES"]`
- `scripts/tools/start_all.sh` — activator launch with `--pair=ETH/USDC-RAMSES`
- `contracts/AllMightRamsesExecutor.sol` — deployed at 0xd2eaa2B2E0c475e418B1682d321eD77558D1b5Fb
