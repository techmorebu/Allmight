# INCIDENT_LOG

**Status:** APPEND-ONLY institutional memory.  
**Authority:** Every operational anomaly gets an entry. No deletions, no rewrites — only corrections via dated addendum.  
**Purpose:** Convert mistakes into institutional knowledge so they never recur silently.

---

## Entry format

Each incident follows this shape:

```
## NNN — Short title
**Date detected:** YYYY-MM-DD  
**Date resolved:** YYYY-MM-DD (or "open" / "deferred")  
**Severity:** LOW / MEDIUM / HIGH / CRITICAL  
**Tier of fix:** T0 / T1 / T2 / T3 / T4 / T5 (per CHANGE_CONTROL.md)

### Problem
One paragraph: what went wrong, what was observed.

### Root cause
What actually caused it. Be specific. Distinguish proximate from systemic.

### Fix
What was done. Include line numbers, file paths, ruling references.

### Prevention
What change ensures this never recurs silently. May reference audit
script sections, doc updates, or process changes.
```

---

## 001 — Activator running ARB/USDC while executor was ETH/USDC (3-week silent drift)

**Date detected:** 2026-05-07  
**Date resolved:** 2026-05-07  
**Severity:** CRITICAL  
**Tier of fix:** T3 (runtime config) — Boss ruling A1

### Problem
The deployed `AllMightRamsesExecutor` contract was hardcoded for the ETH/USDC Ramses V2 pool (`0x30AF...4110`), but the active activator process was running on `pair=ARB/USDC` for ~3 weeks — since session_20260414_0728. All recent activator records were ARB/USDC; volatility module was still tracking ETH/USDC in a separate file. Memory of record, project_state, and surface inventory all said ETH/USDC was the primary surface. The drift had gone undetected through multiple rehearsal attempts because nothing cross-checked producer pair against executor surface.

### Root cause
`scripts/tools/start_all.sh` invoked the activator without a `--pair` flag, defaulting to `ARB/USDC`. There was no validation between the activator's emitted pair and the deployed executor's contract pin. Documentation drift compounded the problem: PROJECT_STATE_CURRENT.md asserted "ETH/USDC Ramses V2 is the primary surface" but didn't claim authority over runtime configuration.

### Fix
Added `--pair=ETH/USDC-RAMSES` to the activator invocation in `scripts/tools/start_all.sh`. Restarted the stack to pick up the new flag. Verified at runtime that the activator emits records with `pair: ETH/USDC-RAMSES`. Boss ruling A1 (2026-05-07).

### Prevention
- `CANONICAL_SURFACE.md` created as authoritative single source of truth.
- `system_integrity_audit.sh` Section 2 now compares activator pair against the deployed executor's expected surface on every audit.
- `audit_rehearsal_wiring.sh` runs as a mandatory preflight before any rehearsal launch.

---

## 002 — Tick-map refresh deadlock in quiet markets

**Date detected:** 2026-05-07  
**Date resolved:** 2026-05-07  
**Severity:** HIGH  
**Tier of fix:** T3 (runtime logic) — Boss ruling B1+B2

### Problem
After ~30 minutes of activator runtime, the tick-map refresh would defer indefinitely with reason `heat_not_elevated_and_not_near_zone`. After 35 minutes, `STATE_UNHEALTHY` would fire with reason `tickmap_stale:Xs`. After 11 more minutes (660s threshold), the activator would `stale_exit` with code 10. The supervisor would relaunch the activator into the same conditions, producing an infinite restart loop. Over 21 hours of session 20260506_0031, the activator emitted 0 EXECUTION_READY signals despite running continuously.

### Root cause
The refresh gate logic in `arb_window_activator.js` was:
```js
const _shouldRefresh = _tickMapDue && (_tickMapForce || _heatElevatedNow ||
                                         _nearZone || state === 'ARMED');
```
In quiet markets:
- `heatClass = UNKNOWN` (heat module needs activator data → cold start can't classify)
- `nearZone = false` (zones derived from stale tick-map)
- `state = PASSIVE` (no ARMED transitions without simulations)
- `tickMapForce = false` (env not set)

Result: refresh always deferred, never succeeded, eventually staleness fired. A frugality optimization (skip RPC-expensive refreshes in quiet markets) had created a Catch-22: heat needs activator data, activator needs fresh tick map, tick map refresh needs elevated heat.

### Fix
Two-part:
- **B1 (immediate):** Set `TICK_MAP_ALWAYS_REFRESH=true` in `.env`. Forces refresh on every due check, bypassing the heat/zone gate.
- **B2 (permanent):** Patched `arb_window_activator.js` to add a hard-cap age override — if `lastTickMapMs` is older than `MAX_TICK_MAP_AGE_MS = 20 min`, force refresh regardless of heat/zone. The 20-min cap is well under the 35-min `HEALTH_TICKMAP_STALE_MS` threshold, so `STATE_UNHEALTHY` from staleness can never fire while the override is reachable.

Boss ruling B1+B2 (2026-05-07).

### Prevention
- `system_integrity_audit.sh` Section 6 reports `tick_map_refresh_deferred` count vs successful refresh count. If deferred > 0 and successful = 0, the audit flags it as `DEADLOCK`.
- Three independent staleness paths now documented in `SYSTEM_STATE.md` acceptable-warning baseline so future incidents can be quickly classified (tickmap_stale vs pool_read_stale vs block_frozen).

---

## 003 — Activator silent death without supervisor relaunch

**Date detected:** 2026-05-06  
**Date resolved:** 2026-05-06 (operational fix only; root cause TBD)  
**Severity:** HIGH  
**Tier of fix:** T3 — operational only, deeper supervisor patch deferred

### Problem
Session 20260505_0755 stopped writing to `activator.jsonl` at 20:50:34 UTC. The activator process was no longer running when checked at 04:14 UTC the next day (~7.5 hours later). The supervisor wrapper (`restart_wrapper.sh` per memory, but not at expected path) did not restart it. Subsequent operations (preflight, rehearsal launches) continued against the dead-pipe session, producing TIMEOUT_NO_SIGNAL because no new signals were being generated.

### Root cause
**Root cause classification: unresolved supervisor orchestration failure.**

Possibilities not yet fully isolated:
- Supervisor script (`restart_wrapper.sh`) was never running in this session
- Supervisor caught the exit but treated it as fatal-permanent
- Supervisor's restart logic doesn't cover the specific exit code that fired

The supervisor was found at `_legacy/root_clutter/restart_wrapper.sh` rather than the expected `scripts/tools/` path, suggesting a relocation that broke the canonical invocation pattern.

### Fix
Manual stack restart via `scripts/tools/start_all.sh` brought up a fresh session (20260506_0031). Subsequent sessions have been monitored more actively. Permanent supervisor fix deferred — the start_all.sh launch sequence does include process restart on failure, but the broader watchdog logic needs review.

### Prevention
- `system_integrity_audit.sh` Section 1 (Process Census) compares expected processes (per `logs/allmight.pid`) against actual running processes. Missing critical processes are flagged immediately.
- Session-mtime checks added: if activator.jsonl mtime is older than 120s but the audit expects the session to be active, it flags as ❌.
- Phase H1 hardening (Boss-queued post-rehearsal): isolate provider-source attribution + record provider selected during stale events.

---

## 004 — Rehearsal launched against dead-pipe session

**Date detected:** 2026-05-06  
**Date resolved:** 2026-05-06  
**Severity:** MEDIUM  
**Tier of fix:** T1 (observability)

### Problem
A 30-minute dry rehearsal was launched against session 20260505_0755 while its activator was already dead (Incident 003). The rehearsal predictably timed out, but the operator initially attributed it to "market too soft for 26bps signal" rather than the data feed being off. A second 12-hour rehearsal was about to be launched on the same dead session before the data feed health was checked.

### Root cause
The rehearsal launcher (`micro_live_oneshot.js`) checks executor + wallet + .env, but does not validate that the activator data feed it's about to read from is alive and writing fresh records.

### Fix
Built `audit_rehearsal_wiring.sh` (260 lines) as a mandatory preflight before every rehearsal launch. Section 2 verifies activator.jsonl mtime (must be < 120s old), Section 3 verifies a recent JSON record schema. A failed audit blocks the rehearsal launch with exit code 1.

### Prevention
- Audit-before-launch is now operational policy (documented in OPERATOR_RUNBOOK.md).
- The audit's pings include both Discord channels (ops + candidate) so the operator visually confirms routing before relying on it during a rehearsal.

---

## 005 — Hardhat install corruption on first deploy attempt

**Date detected:** 2026-05-05  
**Date resolved:** 2026-05-05  
**Severity:** MEDIUM  
**Tier of fix:** T0 (environment)

### Problem
First attempt to deploy `AllMightRamsesExecutor` failed at config-loading with `Cannot find module '../../types/builtin-tasks'`. The error was deep in `node_modules/hardhat/internal/...`. Subsequent retries reproduced the same failure.

### Root cause
A previous partial install of hardhat had left `src/.ts` files leaking into `internal/` paths where compiled `.js` files were expected. The mixed state was not detected by `npm install`'s normal idempotency checks.

### Fix
```bash
rm -rf node_modules/hardhat
npm install hardhat@^2.22.11
```
Clean reinstall resolved the issue.

### Prevention
- For mainnet deploys, recommended sequence now includes `rm -rf node_modules/.cache` and `npm ci` (instead of `npm install`) for reproducibility.
- This is operator hygiene rather than something the audit can catch.

---

## 006 — Hardhat config rejected MetaMask's 0x-prefixed private key

**Date detected:** 2026-05-05  
**Date resolved:** 2026-05-05  
**Severity:** MEDIUM  
**Tier of fix:** T2 (non-runtime logic, deploy tooling)

### Problem
After fixing the hardhat install (Incident 005), the deploy still failed because the `accounts:` array loader in `hardhat.config.js` was checking `key.length === 64` — i.e., expecting a raw 64-hex string with no prefix. MetaMask exports keys with a `0x` prefix (66 chars total), so the check failed and no accounts were loaded for the network.

### Root cause
The accounts loader was written against an older format convention. The modern dotenv ecosystem (and MetaMask) defaults to `0x`-prefixed strings.

### Fix
Patched `hardhat.config.js` to normalize the input: strip optional `0x`, validate 64-hex character body, prepend `0x` for ethers compatibility. Tier T2 because the change is in deploy tooling, not runtime.

### Prevention
- Hardhat config changes get full syntax-check + a dry compile before deploys.
- Future similar tooling should accept both formats by default.

---

## 007 — Preflight false-negative on revert reason in ethers v6

**Date detected:** 2026-05-05  
**Date resolved:** 2026-05-05  
**Severity:** LOW (didn't block deploy, just noisy reporting)  
**Tier of fix:** T1 (observability)

### Problem
The `preflight_ramses_executor.js` smoke-test was reporting "27/28 PASS, 1 FAIL" when in fact all 28 checks were passing. The "failed" check was correctly producing the expected revert (`DEADLINE_EXPIRED`), but the script was reading the revert reason from `e.message` which in ethers v6 contains an opaque error hash rather than the decoded reason string.

### Root cause
ethers v6 stashes the on-chain revert reason in `e.data` (raw revert data, decode required) rather than `e.message`. The preflight script was written against ethers v5 conventions.

### Fix
Patched the smoke-test to decode `Error(string)` from `e.data` when `e.message` is opaque. Result: 28/28 PASS reporting matches reality.

### Prevention
- Test scripts should be paired with their ethers version assumption documented inline.
- Future ethers upgrades trigger a regression of all preflight scripts.

---

## 008 — Placeholder private key caught at deploy boundary

**Date detected:** 2026-05-05  
**Date resolved:** 2026-05-05  
**Severity:** N/A — this is a fail-closed catch working correctly  
**Tier of fix:** N/A

### Problem
At the start of the deploy session, `.env` contained `METAMASK_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE` as a placeholder. Block A precondition checks caught this before the deploy was attempted.

### Root cause
The placeholder had been left in `.env.example`-style during initial setup; the operator had not yet pasted the real key.

### Fix
Operator pasted the real key. Deploy proceeded.

### Prevention
- Deploy and live-execution scripts now check for `*YOUR_*` patterns in critical env values.
- `.env` mode is enforced 600 (locked to owner) so the real key cannot leak via cohabiting users.
- `.gitignore` covers `.env`, `.env.*`, `.env.bak*` (per Incident 009 below).

This entry exists not as a failure but as an example: **fail-closed catches working as designed.** Document them so they're not eroded over time.

---

## 009 — Private key leak path in .gitignore

**Date detected:** 2026-05-05  
**Date resolved:** 2026-05-05  
**Severity:** HIGH (would have been CRITICAL if a commit happened)  
**Tier of fix:** T0 (config)

### Problem
A backup file `.env.bak.20260505_180247` containing the real private key was created during a normal `.env` edit. The file was untracked but NOT covered by the existing `.gitignore` rules — which only listed `.env`, not `.env.bak*` or `.env.*`. A future `git add -A` could have accidentally committed it.

### Root cause
`.gitignore` was written for the canonical `.env` filename only, not the entire family of `.env`-derived files.

### Fix
Updated `.gitignore` to add:
```
.env.*
.env.bak*
*.bak*
reports/
```
The existing leaked backup was shredded with `shred -u`. Future backups are now blanket-ignored.

### Prevention
- `system_integrity_audit.sh` Section 4 verifies `.env` mode 600.
- The shred-after-use practice is recommended in OPERATOR_RUNBOOK.md.
- A pre-commit hook to grep for `0x[a-fA-F0-9]{64}` patterns in staged files is a queued enhancement.

---

## 010 — Spread gate unit mismatch (resolved historical)

**Date detected:** ~2026-04 (pre-current-session)  
**Date resolved:** ~2026-04  
**Severity:** HIGH  
**Tier of fix:** T4 (execution affecting)

### Problem
`MIN_VIABLE_SPREAD_PCT` was at one point being treated as a fraction (`0.0013` = 0.13%) in some code paths and as a percent (`0.13` = 0.13%) in others. The two units differ by a factor of 100; the wrong unit would have made the gate either trivially permissive or impossibly restrictive.

### Root cause
Convention drift between modules. Some modules used "spread as a fraction of 1.0" (banking convention), others used "spread as a percent value" (trading convention).

### Fix
Standardized on percent form (`0.13` means 0.13%). All comparisons and gates use this convention. Documentation in module headers calls this out explicitly.

### Prevention
- ARCHITECTURE_LOCK.md determinism rules now specify schema requirements at the layer boundaries.
- Boss-locked thresholds are always specified with explicit units in `SYSTEM_STATE.md` and Boss rulings.

---

## 011 — Camelot V3 / Algebra protocol vs UniV3 dispatch confusion

**Date detected:** ~2026-04  
**Date resolved:** ~2026-04  
**Severity:** MEDIUM  
**Tier of fix:** T2 (tooling)

### Problem
Initial attempts to read state from Camelot V3 pools using `slot0()` failed because Camelot V3 is built on the Algebra protocol, which uses `globalState()` instead. The function returns `sqrtPriceX96` at index 0 and the dynamic fee at index 2. UniV3-pattern code didn't decode this correctly.

### Root cause
Camelot V3 forked from Algebra, not UniV3, despite superficial API similarity.

### Fix
Pool readers now dispatch by `camelotType`:
- `camelotType: 'algebra'` → `globalState()` decoder
- `camelotType: 'univ3'` → `slot0()` decoder

Ramses V2 was confirmed to use `slot0()` (despite being branded similarly), so it dispatches as `univ3`.

### Prevention
- Pool registry includes `camelotType` field for every Camelot-fork pool.
- New pool integrations require explicit verification of the protocol type before being added to PAIR_CONFIGS.

---

## 012 — start_all.sh stdout pollution into activator.jsonl

**Date detected:** 2026-05-07  
**Date resolved:** open (queued post-rehearsal cleanup)  
**Severity:** LOW (cosmetic; consumers handle it)  
**Tier of fix:** T2 (deferred)

### Problem
`scripts/tools/start_all.sh` redirects the activator's stdout/stderr to the same file as the activator's `--log` flag:
```bash
node activator.js --log activator.jsonl >> activator.jsonl 2>&1
```
This violates Boss ruling 2026-04-15 ("activator.jsonl shall be JSON-only"). The file becomes ~98% pretty-print rows + ~2% JSON records.

### Root cause
Bash-level stream merging applied without checking against the script's documented JSON-only output convention.

### Fix
Deferred. All consumers (`micro_live_oneshot.js`, audit scripts) handle the mixed format via `try/catch` JSON parsing. Boss B1 hardening + Phase H1 directive will address this when the post-rehearsal cleanup window opens.

### Prevention
- Audit scripts measure JSON parse rate as a metric; sudden drops signal new pollution.
- The cleanup will redirect stdout to a separate `activator.console.log` and reserve `activator.jsonl` for the JSON appendLog output only.

---

## 013 — Audit script `0\n0` cosmetic counter bug

**Date detected:** 2026-05-07  
**Date resolved:** open (queued)  
**Severity:** LOW (cosmetic)  
**Tier of fix:** T1 (observability)

### Problem
`system_integrity_audit.sh` Sections 6 and 7 produce `0\n0` strings when `grep -c` returns 0 matches (and the `|| echo 0` fallback also fires). The shell `[` comparison fails on the multi-line value, producing `[: 0\n0: integer expression expected` errors. Counts in human-readable form are correct; only the programmatic comparison fails.

### Root cause
`grep -c '...' file || echo 0` — when grep finds 0 matches, it returns `0\n` to stdout AND non-zero exit code. The `||` triggers, appending another `0\n`. The variable holds `0\n0`.

### Fix
Queued: replace pattern with `wc -l < <(grep '...' file)` or pipe grep output through `tr -d '\n'`.

### Prevention
- Audit script will get a v2 patch to fix this and the false-strict signal-record check from Incident 014.
- Tier T1, can be applied without ruling.

---

## 014 — Audit script false-strict signal record check

**Date detected:** 2026-05-07  
**Date resolved:** open (queued)  
**Severity:** LOW (cosmetic)  
**Tier of fix:** T1 (observability)

### Problem
`audit_rehearsal_wiring.sh` Section 3 (and `system_integrity_audit.sh` Section 3) sample only the last 100 lines of `activator.jsonl` for a signal record. Combined with the start_all.sh pollution (Incident 012), JSON records appear at ~1-2% density, so the last 100 lines often contain zero signal records — even when the file as a whole has many. The audit reports ❌ "no signal record in last 2000 lines" or "no JSON in last 100 lines" as a critical failure when the underlying state is fine.

### Root cause
Tail-window too narrow given the JSON pollution density.

### Fix
Queued: scan the last 5000 lines, OR scan until N JSON records are found (whichever comes first).

### Prevention
- Same v2 audit patch as Incident 013.

---

## 015 — micro_live_oneshot staticCall NOT_OWNER (provider-bound contract instance)

**Date detected:** 2026-05-08  
**Date resolved:** pending patch validation (patch approved, awaiting rehearsal proof)  
**Severity:** HIGH  
**Tier of fix:** T4 (execution-affecting) — Boss ruling 2026-05-08 Option 1

### Problem
During the J2 12-hour dry rehearsal (launched 2026-05-07 13:46 CDT), every qualifying spread signal — including 10 signals at ≥26 bps (live-floor) and 438 signals at ≥20 bps (rehearsal floor) — was rejected at gate `callStatic_pass1` with `reason=NOT_OWNER`. The activator pipeline was correctly producing EXECUTION_READY signals; the failure was downstream at the simulation step in `micro_live_oneshot.js`. Result: a 4-minute window with multiple ≥25 bps signals produced zero DRY_MODE_LOCK_PLAN emissions. The `[4]` runtime-proof gate remained unmet.

This bug also retroactively explains prior rehearsals classified as `TIMEOUT_NO_SIGNAL` — those windows likely contained qualifiers being silently rejected at the same gate. The "no signal" finding was actually "qualifiers always rejected."

### Root cause
Two contract instances are constructed in `scripts/execution/micro_live_oneshot.js` at lines 560-561:
```js
executorRO = new ethers.Contract(EXECUTOR_ADDRESS, EXECUTOR_ABI, provider);  // no signer
executorRW = new ethers.Contract(EXECUTOR_ADDRESS, EXECUTOR_ABI, wallet);    // has signer
```
The wallet is correctly verified as owner at lines 574-577 (using `.owner()` view function), and that check passes — the wallet IS the owner. But the two callStatic invocations at lines 755 and 780 use `executorRO` (provider-bound, no signer). In ethers v6, calling `.staticCall()` on a provider-bound contract uses the **zero address** as the default `from`. The executor's `onlyOwner` modifier requires `msg.sender == owner`. Zero address ≠ owner → `NOT_OWNER` revert.

Why fork tests didn't catch this: Hardhat's local fork often auto-impersonates the deployer as default `from` for static calls, masking the bug. Alchemy on mainnet does not — it uses zero address as expected by ethers v6 semantics.

### Fix
Boss-ruled Option 1 (2026-05-08): switch the two callStatic sites from `executorRO` to `executorRW`. The signer-bound instance causes ethers v6 to use `wallet.address` as the default `from`, which equals the verified owner.

Single sed pattern covers both sites:
```bash
sed -i 's/callStaticPass(executorRO,/callStaticPass(executorRW,/g' \
   scripts/execution/micro_live_oneshot.js
```
View-function calls (`.owner()`, `.USDC()`, `.bytecode`) at lines 568-577 remain on `executorRO` — those have no signer requirement.

### Why fail-closed prevented financial damage
The simulation gate exists specifically to catch revert-prone inputs before broadcast. Every NOT_OWNER outcome was a fail-closed catch. Zero live submissions were attempted with the bug present. Capital remained intact throughout. **The blast radius was 100% contained by design.**

### Prevention
- `system_integrity_audit.sh` v2 (queued) will validate that any staticCall in execution-path scripts uses a signer-bound contract instance.
- Future preflight scripts must include a "synthetic dry call" that exercises the actual gate path against the real RPC, not just view-function checks.
- Rehearsal evidence quality bar updated: a TIMEOUT outcome is NOT proof of "no qualifier" until the log distribution of GATE_FAIL reasons is inspected by gate-class.

---

## 016 — J2 dry-rehearsal watcher silent death mid-window

**Date detected:** 2026-05-08  
**Date resolved:** mitigated (hardware fix from 018 addresses root cause; observability still queued)  
**Severity:** HIGH (created false TIMEOUT interpretation, undermined coverage)  
**Tier of fix:** T3 (runtime reliability) — Boss ruling 2026-05-08 separate from 015

### Problem
The J2 rehearsal process (PID 346412, `micro_live_oneshot.js --dry --max-wait-sec 43200`) was launched 2026-05-07 13:46 CDT for a 12-hour window. Its log file stopped writing at 2026-05-07 20:16:02 CDT — 6h 30m into the 12h window. The process was no longer running when checked the following morning. No `WATCH_END`, no `TIMEOUT`, no `ERROR`/`FATAL`, no graceful-shutdown record. The log simply stopped mid-stream after a normal GATE_FAIL line.

This created two harms:
1. The morning post-mortem initially looked for the rehearsal's TIMEOUT outcome in `micro_live_trade.json` — but that file still held the prior rehearsal's content. Result: the wrong rehearsal outcome was almost cited.
2. Even with the bug from 015 present, the remaining ~5.5 hours of intended coverage were lost. Any genuine qualifier in that window went unobserved.

### Root cause
Underlying filesystem corruption (see 018) caused log-write I/O errors. The Node process likely threw an uncaught exception during `fs.appendFile` to a corrupted inode and exited without writing a final outcome record. nohup-launched processes don't trigger systemd kill records, so journalctl was empty.

The watcher's process lifecycle should have surfaced this — but didn't:
- No "heartbeat" emission from the rehearsal process itself
- No external sidecar process checking the watcher PID
- The notification_router routes events FROM the rehearsal but doesn't monitor the rehearsal's liveness

### Fix
Operational fix: hardware upgrade resolved the underlying I/O fault (see 018). Observability fix is queued under Phase H1 reliability:
- Rehearsal process emits its own heartbeat to activator-independent file every N minutes
- Watchdog tracks rehearsal-process PID separately from the canonical 8 processes
- Discord alert if rehearsal PID disappears before its declared `--max-wait-sec` window expires

### Prevention
- Boss-ruled framing: "coverage continuity" is the architectural goal — not "always-on trading." Rehearsal coverage gaps undermine evidence trustworthiness.
- Pre-live storage gate (see 018 prevention) reduces FS-induced exits to near-zero in practice.
- OPERATOR_RUNBOOK.md updated: after any rehearsal launch, verify the PID is still alive 60 seconds in AND at least once per hour during the window if checking opportunistically.

---

## 017 — Three canonical processes silently terminated in a 2-minute window

**Date detected:** 2026-05-08  
**Date resolved:** root cause shared with 018; resolved with hardware  
**Severity:** HIGH (watchdog did not surface deaths via Discord)  
**Tier of fix:** T3 (runtime orchestration) — Boss ruling 2026-05-08 separate from 015 and 016

### Problem
Post-J2 review found three of the canonical 8 processes missing from `ps aux`:
- `fetcher` (master-fetcher.js) — last wrote 2026-05-07 23:52 CDT
- `volatility` (arb_volatility_monitor.js) — last wrote 2026-05-07 23:52 CDT
- `shadow_engine` — last wrote 2026-05-07 23:50 CDT

All three deaths fell inside a 2-minute window — strong evidence of a correlated, system-level event rather than independent application failures. The remaining processes (activator, heat, monitor, watchdog, notification_router) survived. The watchdog's log showed all-alive entries from BEFORE the deaths but no DEAD/FAILED records corresponding to them — and no Discord alert fired to surface the partial-stack degradation to the operator.

### Root cause
Same underlying cause as 018: filesystem corruption on the unpowered USB-attached NVMe. The three deaths correlate to a single I/O event affecting their respective log writes. The watchdog's coverage gap is secondary:
- The watchdog samples process state at intervals (60s)
- The watchdog itself was likely affected by the same FS issue (its own log writes pass through the same corrupted volume)
- The watchdog's Discord alert path was never triggered because the watchdog couldn't reliably write its own state record

### Fix
Hardware upgrade (see 018) addressed the root cause. Watchdog coverage improvements are queued under Phase H1 reliability:
- Watchdog runs from a non-corrupted partition where possible (e.g., a tmpfs scratch dir for its state)
- Watchdog uses synchronous fsync after each state write to detect FS issues immediately
- Critical-process death triggers an immediate Discord ops-channel alert (vs the current 60s sample interval)

### Prevention
- `system_integrity_audit.sh` Section 1 (Process Census) explicitly checks all 8 canonical processes by name, not by PID-file alone. PID files can be stale even when the process is dead.
- Watchdog config (post-018): heartbeat write goes to /run (tmpfs) rather than /home (root FS); the watchdog itself becomes resilient to root-FS faults.
- OPERATOR_RUNBOOK.md updated: morning paste should verify process census against `cat logs/allmight.pid` AND `ps aux`. If those disagree, the stack is degraded.

---

## 018 — Filesystem corruption on /dev/sdc2 (root FS) from unpowered USB enclosure

**Date detected:** 2026-05-08  
**Date resolved:** 2026-05-19 (hardware replacement complete; observation window started)  
**Severity:** CRITICAL — affected stack reliability + threatened private key  
**Tier of fix:** Hardware/infrastructure (outside CHANGE_CONTROL.md tiers; documented as institutional event)

### Problem
EXT4 filesystem corruption on the primary disk hosting `~/Allmight` caused silent process deaths without exit codes or systemd records. dmesg showed repeated errors against inode #800589:
```
EXT4-fs error (device sdc2): __ext4_find_entry:1624: inode #800589: comm node: checksumming directory block 0
EXT4-fs error (device sdc2): htree_dirblock_to_tree:1051: inode #800589: comm rm: Directory block failed checksum
EXT4-fs error (device sdc2): ext4_empty_dir:3080: inode #800589: comm npm install har: Directory block failed checksum
```
The corruption cascaded into incidents 016 and 017 (silent process deaths). Most critically: `.env` resides on this same volume. Further corruption progressing to its inode would have rendered the deployer wallet's private key unrecoverable. With the executor contract on-chain and owned by that key, loss of the key would have meant loss of contract ownership.

### Root cause
**Hardware delivery path failure, not media failure.** SMART data on the underlying ORICO-1TB NVMe (S/N 9140907001395) showed: SMART overall PASSED, 0 media errors, 100% available spare, 0% used, no critical warnings. **But:** `Unsafe Shutdowns = 59` over 2,004 power-on hours — roughly one unsafe shutdown per 34 hours of operation.

Architecture:
- Single USB-C port on laptop
- Unpowered USB splitter dividing that port between the ORICO NVMe enclosure AND a wireless mouse dongle
- ORICO enclosure with budget-tier bridge chip (JMicron-class behavior observed)
- The NVMe is the OS root filesystem — every system operation writes through this chain

Mechanism: NVMe under sustained load (logs, swap, journald, application JSONL) draws 3-6W. A USB-C port has finite power budget. The unpowered splitter divided that budget AND introduced impedance/signal-integrity issues. When the drive's draw exceeded the available delivery, the enclosure browned out — drive lost power mid-write — kernel detected unsafe shutdown — filesystem directory blocks left in inconsistent state. Repeat 59 times over 83 days, and inode #800589's directory block accumulates checksum corruption.

### Why fail-closed prevented financial damage
- `.env` remained disarmed throughout (LIVE_DEPLOY_APPROVED=false, AUTO_MICRO_ONESHOT=false)
- Constitutional baseline already pushed to origin (commit 1041de0, tag phase3_baseline_20260507) BEFORE this corruption manifested — repository was fully recoverable
- Wallet private key was correctly identified as the only non-recoverable on-disk asset; emergency backup was executed before further activity
- Watchdog did not surface the partial-stack degradation to Discord, but no live trade was in flight, so no broadcast risk
- Boss-directed sequence prioritized evidence preservation before action: backup before reinstall, dmesg evidence captured to non-volatile storage

### Fix
Two-layer resolution:

**Layer 1 — system recovery (2026-05-08 through 2026-05-19):**
1. Capital preservation: wallet seed off-disk, `.env` age-encrypted, dmesg evidence archived
2. Stack stopped to halt further writes to corrupted volume
3. Boss-ruled migration plan: fresh Ubuntu reinstall + git clone from origin + restore .env from offline backup + npm ci
4. Verified executor still on-chain (bytecode 8307 bytes at canonical address)
5. Verified wallet balance unchanged (0.042322364... ETH — byte-exact match with pre-incident SYSTEM_STATE.md)

**Layer 2 — hardware delivery fix (2026-05-19):**
1. Powered USB-C hub with dedicated DC adapter (separates drive power from laptop USB port)
2. Powered NVMe enclosure (replaces the budget ORICO enclosure)
3. Quality short USB-C cable rated USB 3.2 Gen 2 (10Gbps)
4. New device path: `/dev/sda2` (was `/dev/sdc2` under unpowered setup)
5. SMART baseline captured post-upgrade on 2026-05-19

### Prevention
- **Pre-live storage gate (proposed, awaiting Boss formal ruling):** 7-day continuous observation post-hardware-upgrade with `smartctl Unsafe_Shutdowns` delta = 0 before unattended live execution is authorized.
- `system_integrity_audit.sh` v2 (queued): include disk-health check; flag SMART Reallocated_Sectors / Current_Pending_Sector / Unsafe_Shutdowns delta as advisories.
- OPERATOR_RUNBOOK.md updated emergency disarm section: any application-log silence without corresponding application error → check `dmesg` BEFORE assuming application bug. Silent process death without a JS-level exception is a STRONG signal to inspect kernel-layer telemetry first.
- Hardware standard (going forward): production-class storage delivery requires powered enclosures and powered hubs; bus-powered budget USB enclosures are explicitly excluded from production paths.
- Long-term: internal NVMe install is not possible on the current laptop (TP401CA limitation — eMMC variant with no usable M.2 slot, or M.2 SATA-only on variants that have it). The powered external configuration is the production setup for this hardware.

---

## Recurring patterns

When the same class of incident recurs, document the pattern here so prevention can move upstream.

```
Pattern: silent runtime/doc drift
  Instances: 001 (pair drift), 010 (unit mismatch)
  Common cause: no single source of truth, no audit cross-check
  Upstream prevention: CANONICAL_SURFACE.md + system_integrity_audit.sh
                       Section 2 + Section 8 (drift vs PROJECT_STATE)

Pattern: optimization-induced deadlock
  Instances: 002 (tick-map deadlock)
  Common cause: gating an essential refresh on a derived state that
                requires the refresh to compute
  Upstream prevention: any cached-or-skipped read MUST have a hard
                       max-age override

Pattern: tooling-vs-runtime version drift
  Instances: 005 (hardhat install), 007 (ethers v6 parser),
             011 (Camelot Algebra dispatch), 015 (ethers v6 staticCall
             from-address semantics)
  Common cause: dependency upgrade without paired test sweep;
                fork-test behavior differs from mainnet behavior
  Upstream prevention: deploy and preflight scripts pin versions;
                       test sweeps after dep upgrades are mandatory;
                       any test that passes only on a fork must be
                       paired with a mainnet-RPC smoke test

Pattern: fail-closed catches working correctly
  Instances: 008 (placeholder key), 003 (activator dead detected),
             004 (rehearsal launched on dead pipe),
             015 (callStatic NOT_OWNER blocked all qualifiers),
             018 (capital preservation through hardware crisis)
  Document these so they're not eroded over time. Each catch is a
  paid-for safety net and must remain.

Pattern: observability gaps masking healthy logic
  Instances: 007 (ethers parser), 012 (stdout pollution),
             013 (audit counter), 014 (audit tail-window),
             015 (TIMEOUT vs qualifier-rejected distinction)
  Common cause: telemetry / reporting layer diverged from runtime truth
  Upstream prevention:
    - JSON-only transport boundaries (no log pollution)
    - audit scripts must validate assumptions against runtime artifacts
    - reporting tools are infrastructure, not cosmetics
    - gate-class distribution must be visible at every outcome
  Why this matters: several incidents were NOT actual execution
  failures — they were visibility failures. Fixing visibility is
  not lower priority than fixing logic; broken visibility hides
  failures that ARE about logic.

Pattern: hardware/subsystem failure manifesting as application silence
  Instances: 016 (silent watcher death), 017 (correlated process deaths),
             018 (filesystem corruption from USB brownouts)
  Common cause: low-level kernel/FS errors that throw exceptions outside
                the JS event loop, producing no application-layer error
  Upstream prevention:
    - Investigation discipline: silent process death without an
      application-layer exception → check dmesg FIRST, not application code
    - Hardware delivery path is part of the architecture, not a given:
      power, cables, enclosures, and bus topology all affect reliability
    - Operator runbook emphasizes kernel-layer telemetry as a primary
      diagnostic, not a last resort
```

---

## How to add an entry

```
1. Reserve the next NNN number.
2. Fill in the format template at the top of this file.
3. Be specific about line numbers, file paths, ruling refs.
4. Append the entry to the bottom of the chronological list.
5. If a recurring pattern is emerging, update the
   "Recurring patterns" section.
6. Commit with message:
     "incident: NNN — short title (Tier T?)"
```

**Never delete or rewrite an entry.** Corrections go in dated addendums:

```
### Addendum 2026-05-15
The fix originally cited line 1265 was actually at line 1271
after Boss B2 patch reformatted the surrounding code. Reference:
INCIDENT 002, original entry stands; line number updated.
```

---

## References

- `ARCHITECTURE_LOCK.md` — what kinds of changes the architecture forbids
- `CHANGE_CONTROL.md` — how to classify the tier of a fix
- `SYSTEM_STATE.md` — current authoritative runtime state (where waivers live)
- `OPERATOR_RUNBOOK.md` — emergency procedures referenced from this log

---

## Final clause

This file is the most valuable long-term asset in `docs/current/`. Future incidents will happen — that's the nature of operating real infrastructure. What matters is that **each incident makes the system stronger** by becoming an entry here. The system Boss said you're building isn't just the bot. It's the discipline around the bot. This file is that discipline made permanent.
