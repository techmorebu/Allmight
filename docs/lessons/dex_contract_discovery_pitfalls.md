# DEX Contract Discovery Pitfalls

Hard-won lessons from integrating new venues. Update after every painful debug.

## Golden rule

**Never trust a single source for a contract's identity or role.** BaseScan and
Etherscan public name tags are often misleading or stale. Cross-reference at
least two of:

1. The contract's actual ABI / source code on the explorer (not the label)
2. The project's official GitHub repo's deployments file or README
3. The project's official docs page

When sources disagree, GitHub deployments usually win — they're the canonical
record of what was actually deployed.

## Symptom → cause table

| Error your code sees                       | Likely cause                                                                 | First move                                              |
|--------------------------------------------|------------------------------------------------------------------------------|---------------------------------------------------------|
| "RPC exhausted" via middleware wrapper     | Underlying call reverts; middleware burns through endpoints before bubbling | Bypass middleware with a direct ethers.JsonRpcProvider  |
| "missing revert data, data=null"           | Selector missing OR function reverts with no reason — ambiguous              | Test multiple ABI variants against the address directly |
| Returns 0x0 address                        | UniV3-style: pool not deployed at those params                              | Try other params; not a code-side error                 |
| Returns nonzero but liquidity = 0          | Pool deployed but unused — empty CLAMM                                       | Skip; not a viable surface                              |
| Function reverts on missing pool           | Solidly/Slipstream-style: lookup reverts instead of returning 0x0           | Catch revert; continue iterating other params           |
| All functions return 0x0 but contract has code | Likely a proxy / implementation contract, not the canonical interface     | Identify with no-arg readers (see playbook Step 2)      |

## Diagnostic playbook — apply when integrating any new venue

### Step 1 — Bypass middleware
Build a minimal ethers script with hardcoded public RPC URLs. No
provider_factory, no retry logic, no quota tracking. Test the factory ABI
directly with a fresh `ethers.JsonRpcProvider`. Convention:
`scripts/diagnostics/<venue>_abi_probe.js`.

This is non-negotiable. Middleware can mask "selector missing" as "RPC
exhausted" by burning through endpoints on every revert. You'll waste hours
chasing a network issue that was actually a one-line ABI mismatch.

### Step 2 — Identify the contract via no-arg readers
If you have a contract address but aren't sure what type of contract it is,
probe these common getters:

```
factory()        owner()       nft()           factoryRegistry()
WETH9()          tickSpacing() fee()           slot0()
name()           symbol()      allPoolsLength()
```

The set that succeeds reveals the category (pool, factory, router, position
manager, swap router, beacon, etc.). A contract that successfully returns
from `slot0()` is almost certainly a pool, not a factory.

### Step 3 — Cross-reference canonical deployments
Required before integrating any venue:

1. Project's official GitHub repo — `README.md` deployments table or
   `deployments.json`
2. Project's official docs page
3. BaseScan / Etherscan public name tag — **treat as hint, never as fact**

Never integrate from a single source. Confirm two minimum.

## The BaseScan label trap — Wave 4 case study

**`0xeC8E5342B19977B4eF8892e02D8DAEcfa1315831`** on Base is publicly labeled
"Aerodrome: SlipStream Pool Factory" on BaseScan. **It is NOT a factory.**
It is the PoolImplementation — the CLPool template that the actual factory
clones from via EIP-1167. We wired it into `config/chains.json` as the
Slipstream factory; every `getPool` call failed.

**Diagnostic clue we initially missed**: BaseScan's *Contract Name* field
(visible only when you click into the source code, not on the address
overview page) said `CLPool`. The public name tag was misleading.

**Resolution**: consulted the official `aerodrome-finance/slipstream` GitHub
repo's README deployments table. Three Slipstream deployments exist on Base,
each with its own PoolFactory address:

- **V1 (Initial Deployment, active)**: `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A`
- **V2 (Gauge Caps Deployment)**:       `0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a`
- **V3 (Gauges V3, newest)**:           `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef`

**Lesson**: always check the project's deployments file in their GitHub
before integrating. It's the canonical source of truth. Explorer labels are
crowdsourced and frequently wrong.

## Aerodrome on Base — verified addresses & conventions

### V2 (Solidly fork, AMM-style)
- **PoolFactory**: `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` ✓
- ABI: `function getPool(address tokenA, address tokenB, bool stable) view returns (address)`
- **Returns 0x0 for non-existent pools** (UniV2-like behavior)
- ETH/USDC volatile pool: `0xcDAC0d6c6C59727a65F871236188350531885C43`

⚠️ Aerodrome V2 uses `getPool`, **NOT `getPair`**. Different from Uniswap V2,
which uses `getPair`. They're both factories, both V2-style, but the function
name differs because Aerodrome is a Solidly fork.

### Slipstream V1 — Initial Deployment (active, canonical pools)
- **PoolFactory**:        `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` ✓
- **PoolImplementation**: `0xeC8E5342B19977B4eF8892e02D8DAEcfa1315831` ← NOT a factory!
- ABI: `function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)`
- ⚠️ **REVERTS for non-existent pools** (different from UniV3!)
- Pool ABI is UniV3-style: `slot0()`, `liquidity()`, `fee()`, `tickSpacing()`
- ETH/USDC pools observed (2026-05-30):
  - tickSpacing=1, fee=0.008%, pool=`0xdbc6998296caA1652A810dc8D3BaF4A8294330f1`, liquidity≈2.26e16
  - tickSpacing=50, fee=0.05%, pool=`0xAaD23a67F2AC693ABBe543489aeB3F24F561D517`, **liquidity=0 (EMPTY)**
  - Other tick spacings (100, 200, 500, 2500, 10000): not deployed

### Slipstream V2 — Gauge Caps Deployment
- **PoolFactory**: `0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a`
- No ETH/USDC pools deployed (as of 2026-05-30)

### Slipstream V3 — Gauges V3 (newest, future deployments)
- **PoolFactory**: `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef`
- No ETH/USDC pools deployed (as of 2026-05-30)

## Convention divergence quick-reference

| Convention                       | UniV3       | Aerodrome V2     | Aerodrome Slipstream     |
|----------------------------------|-------------|------------------|--------------------------|
| Pool-lookup function name        | getPool     | getPool          | getPool                  |
| Pool discriminator               | uint24 fee  | bool stable      | int24 tickSpacing        |
| Non-existent pool behavior       | returns 0x0 | returns 0x0      | **REVERTS**              |
| Pool slot0 / liquidity / fee     | yes         | no               | yes                      |
| Pool getReserves                 | no          | yes              | no                       |
| Fee semantics                    | fee tier = fee | fee per-pool  | fee per-pool, decoupled from tickSpacing |

## Tooling lesson — anchor design for surgical edits

Multi-line string anchors in deploy scripts are fragile when the file contains
non-ASCII characters (em-dashes, box-drawing chars, smart quotes). One byte
difference between the deploy's Python string literal and the file on disk
breaks the match silently.

**Rule**: prefer single-line ASCII-only anchors. If a multi-line anchor is
unavoidable, validate it against the actual file BEFORE committing to it in
the deploy. The Wave 4 Commit 4 deploy failed Stage 2d with a multi-line
anchor that contained an em-dash; resumed successfully by switching to a
single-line anchor (the V3 comment line) and prepending the new block.

## When to update this doc

- After every successful new-venue integration (add to address registry)
- After every diagnostic that exposes a non-obvious contract pattern (add to symptom table)
- When discovering protocol-specific revert/return conventions (add to convention table)
- When a misleading explorer label costs us time (note in trap registry)
- When tooling lessons emerge during deploy authoring (add to tooling lesson section)

This file is the project's institutional memory for DEX integration.
The next person who hits a similar wall should be unblocked in minutes,
not hours.

## Wave 4 Commit 4 deploy post-mortem (two anchor failures)

The deploy_commit4.sh script failed twice before succeeding. Both
failures are recorded here for future-proofing.

### Failure 1 — multi-line anchor with unaccounted blank line

Stage 2d used a 5-line Python string anchor to locate the V2-to-V3
boundary in `multi_pair_pool_discovery.js`. Initial suspicion: the
em-dash in `(V2 doesn't iterate fee tiers — they're not a thing...)`
didn't match the file's bytes.

`cat -A` forensics on the actual file region revealed:

```
      break;$
    }$
$                ← BLANK LINE not in the anchor
    // ── Standard V3 factory: getPool(A, B, fee) ──$
```

The em-dash rendered correctly as `M-bM-^@M-^T` (UTF-8 bytes
`\xe2\x80\x94`). The actual culprit was the **blank line** between
the if-block close brace and the V3 comment that my anchor didn't
account for.

**Lesson**: when recon-ing for surgical edits via `sed -n` or `grep`,
blank lines between code sections aren't always obvious in the
display. Run `sed -n '<start>,<end>p' file | cat -A` during recon
to expose them. Better still: prefer single-line ASCII-only anchors
that match a unique, stable comment or constant name.

### Failure 2 — implicit allow-list dependency

After fixing Failure 1, Stage 5 validation surfaced:

```
❌ venue base.aerodrome_slipstream: type must be one of
   [uniswap_v3, algebra, aerodrome_v2] (got "slipstream")
```

`scripts/tools/validate_chain_config.js` hard-codes the accepted venue
types in an array literal. Adding a new venue type to `chains.json`
requires updating this allow-list — otherwise the validator rejects
the very config we just changed.

**Lesson**: when adding a new venue type, grep the whole repo for any
hard-coded allow-lists of venue types before commit:

```bash
grep -rn "uniswap_v3.*algebra.*aerodrome" --include="*.js"
```

Each match needs the new type appended. Long-term fix: make the
validator's allow-list dynamic — read it from a single registry file
(or derive from VENUE_TYPE_MAP) so it's impossible to forget.

### Tooling lesson summary for future deploy authors

1. Prefer single-line anchors over multi-line. Multi-line anchors are
   sensitive to whitespace, blank lines, and non-ASCII characters.
2. Always `cat -A` the recon output before writing anchors.
3. Search for hard-coded allow-lists of new symbols before adding them.
4. `set -euo pipefail` saved us: the validator's exit-1 prevented a
   broken commit. Trust the gauntlet.
