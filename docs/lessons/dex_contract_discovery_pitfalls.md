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

## Slipstream pool-side slot0 ABI divergence (Wave 4 Commit 5)

Even after fixing the FACTORY ABI in Commit 4, Slipstream POOL reads
failed because the pool's `slot0()` returns 6 fields, not 7 like UniV3.

| Function | UniswapV3 returns                                       | Aerodrome Slipstream returns                       |
|----------|---------------------------------------------------------|----------------------------------------------------|
| slot0    | uint160, int24, uint16, uint16, uint16, **uint8**, bool | uint160, int24, uint16, uint16, uint16, bool       |
|          | (`feeProtocol` field present)                           | (`feeProtocol` REMOVED in the Aerodrome fork)      |

When ethers tries to decode a 6-field response as 7 fields, it fails with
`could not decode result data` and provider_factory reports `RPC exhausted`
after retries. **This was a hard error to track down**: the surface
symptom (middleware exhaustion) looked like a network issue, but the
root cause was a pool-side ABI mismatch.

**Fix**: separate ABI per venue type. `SLIPSTREAM_SLOT0_ABI` in discovery,
`POOL_ABI.slipstream` in probe. Dispatched via `slotFn: 'slot0_slipstream'`
in the VENUE_TYPE_MAP entry.

### Generalized lesson

Identifying the factory's ABI is necessary but not sufficient. The pool's
read ABIs (slot0, fee, liquidity, etc.) may also differ from the parent
protocol's ABIs even when the protocol is a "fork". When integrating a
new venue, sample EVERY read function against an actual deployed pool,
not just the factory's deployment claims.

### Pool ABI verification checklist for new venues

For each new pool type, run a direct ethers read against an actual
deployed pool and verify:

- [ ] `slot0()` return tuple matches your ABI EXACTLY (count + types)
- [ ] `liquidity()` returns the expected type (usually uint128)
- [ ] `fee()` exists and returns uint24 (some forks rename or omit)
- [ ] `tickSpacing()` exists and returns int24 (some forks store fee
       and tickSpacing differently)
- [ ] `token0()` / `token1()` return the expected addresses
- [ ] `getReserves()` only on AMM-style pools (not CL pools)

If any of these mismatch your assumed ABI, dispatch to a venue-specific
ABI rather than treating it as an alias of the parent protocol.

### Known cosmetic debt after Commit 5

The discovery output table shows the QUERIED `feeTier` as the "fee" column.
For UniV3 this is correct (feeTier == fee). For Slipstream, the queried
value is actually the `tickSpacing`, and the real fee is read separately
via `pool.fee()`. Currently the discovery table shows misleading fee values
for Slipstream rows (e.g., "0.0001%" for `tickSpacing=1` when the real fee
is 0.008%). Pool addresses and depth math are correct. Real `pool.fee()`
read + display can be added later if ranking requires it.

### Why "RPC exhausted" was the wrong error message

provider_factory's retry-on-failure logic treats decoding errors the
same way it treats network errors — retry on a different endpoint. When
the ABI mismatch is at the application layer (ethers decoding), every
endpoint returns the same valid response that we then fail to decode the
same way. After exhausting the endpoint pool with the same decoding
failure, the wrapper reports "RPC exhausted" — actively misleading.

**Improvement opportunity (future)**: provider_factory should differentiate
between transient network failures (worth retrying) and deterministic
application-layer failures (not worth retrying — same outcome on every
endpoint). Decoding errors should bubble up with their original message,
not be classified as RPC exhaustion. Tracked as engineering debt.

---

## Protocol lineage is a search prior, ABI is an empirical fact

**Date**: 2026-06-04 (Wave 9 Step 2 — Mantle Cleopatra factory verification, commit 316995e)

**Boss principle (C9 ruling 2026-06-04)**:
> "Protocol lineage is a search prior. ABI behavior is an empirical fact.
> Cleopatra can still be an authorized Ramses fork while exposing a
> standard UniV3 factory interface. That does not invalidate Pattern 4.
> It refines how we test it."

### Context

In Wave 8 (Sonic), the factory verification diagnostic established that Shadow V3 — the Ramses-family CL on Sonic — uses Ramses V3 ABI (`int24 tickSpacing`) rather than standard UniV3 (`uint24 fee`). This led to introducing the `ramses_v3` venue type in wave8 commit `0eb8bdf`.

Wave 9 integrated Mantle Cleopatra, an **officially authorized** Ramses fork:
- BUSL-1.1 license from Ramses, documented at docs.cleo.exchange
- Same AAA-prefix vanity address convention as Arbitrum Ramses (e.g., factory `0xAAA32926fc...`)
- Same overall infrastructure pattern (router, voter, votingEscrow, etc.)

The strong prior was: Cleopatra CL will also use Ramses V3 ABI. Wave 9 Step 1 (`d589332`) registered the venue as `type: ramses_v3` with tickSpacings `[1, 5, 10, 50, 100, 200]`.

Step 2 factory verification (`316995e`) **REJECTED** this prior. Cleopatra CL responds to standard UniV3 `getPool(address, address, uint24 fee)` across standard fee tiers and returns actual pool addresses. The Ramses V3 ABI variant was never reached — UniV3 succeeded first.

### The data

| Surface              | Lineage                 | Factory ABI                |
|----------------------|-------------------------|----------------------------|
| Arbitrum Ramses V2   | original Ramses         | Solidly `getPair()` (V2)   |
| Sonic Shadow V3      | Ramses V3 fork          | `int24 tickSpacing`        |
| Mantle Cleopatra CL  | authorized Ramses fork  | `uint24 fee` (standard V3) |

Three Ramses-family deployments, three different factory ABIs. Lineage did not predict ABI.

### The rule

Every DEX contract integration MUST empirically verify:

1. **Factory ABI** — does `getPool` / `getPair` signature match the expected one? Test multiple variants.
2. **Pool ABI** — does `slot0()` work (standard UniV3) or `globalState()` (Algebra/Camelot)?
3. **Fee semantics** — does the fee field hold a basis-point fee (`uint24`) or a tick spacing (`int24`)?
4. **Pool lookup behavior** — does the factory return a non-zero pool address? Or zero? Or revert?

**NEVER assume ABI from lineage.** The factory verification diagnostic (`scripts/research/<chain>_factory_verification.js`) exists specifically to settle these questions before any code that depends on ABI assumptions ships.

### Procedural enforcement

Wave 9 constitutional flow now codifies:
- Step 2 (factory verification) MUST run before Step 3 (pool ABI) or Step 4 (discovery)
- Empirical findings WIN over lineage-derived `chains.json` entries — config gets corrected post hoc
- Surprises get logged here

### Related commits

- `a6e4852` — sonic factory verification (established Ramses V3 ABI for Shadow)
- `0eb8bdf` — introduced `ramses_v3` venue type (Sonic-specific architecture)
- `316995e` — mantle factory verification (REJECTED `ramses_v3` prior for Cleopatra)
- this commit — `chains.json` correction + this lesson entry

### Pattern 4 status

Pattern 4 does NOT depend on the factory ABI being Ramses-style. It depends on whether the surface behaves like the Arbitrum Ramses winner:
- Deep enough
- Loose enough
- Cheap enough
- Persistent enough

That answer comes from Step 4 discovery + Step 5 probe data, not from lineage.
