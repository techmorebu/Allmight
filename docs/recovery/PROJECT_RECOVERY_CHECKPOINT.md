# ALLMIGHT — RECOVERY CHECKPOINT

**Refreshed:** 2026-09-06 (M2E-017C) · **Authority:** Boss · **Standard:** GOV-CHK-001

```
base (parent) commit   1da984b510b3036074a3ff17340d1d249fb3cc95
this checkpoint         travels in the commit that supersedes that base and
                        records the M2E-017 SHADOW SILENT-FAILURE SOURCE REPAIR
                        CANDIDATE — VERIFIED, NOT COMMITTED, runtime not
                        remediated. Canonical repository source REMAINS THE
                        PREIMAGE until a successful Phase B commit.
                        The running wrapper has NOT been restarted.
```

> **PRECEDENCE — running machine > repository > this document > chat memory.**
> A recovery document that outranks reality becomes the next false-assurance
> artifact. Verify before trusting; **report disagreement, never reconcile it
> silently.**

---

## 1. WHAT IS ALLMIGHT

A DEX arbitrage system on Arbitrum mainnet. **Boss** (ChatGPT) rules; **CPT**
(Claude) implements, validates and reports; **Cornelius** operates the machine.
No architectural, threshold or phase change happens without an explicit ruling.

```
repository  techmorebu/Allmight   PUBLIC   branch main
executor    0xd2eaa2B2E0c475e418B1682d321eD77558D1b5Fb
```

## 2. HARD LOCKS — ALL ENGAGED

```
LIVE_TRADING_ENABLED false · AUTO_MICRO_ONESHOT false · LIVE_DEPLOY_APPROVED false
signing NONE · broadcast LOCKED · capital UNTOUCHED · economics PARKED
```

**Economics are PARKED on evidence:** median **+$0.00528 pre-gas at $10**, price
impact 4–7× the edge, and 32.95% of survivor signals describe a direction the
executor cannot perform. **Infrastructure quality is not an argument for
capital.**

## 3. CURRENT RUNTIME

```
session   20260904_2239   (pointer mtime is the start authority — never the SID)
stack     8/8 non-live
router    pid 1668840, started after the RTR-004 commit — instrumentation ARMED
watchdog  pid 1668839, running the corrected identity dispatch (082f6da8…)
          NOTE: the pid file records the WATCHDOG SCRIPT, which is correct —
          the watchdog IS a shell. That is not an Incident 023 instance.
```

**M2E-001 volatility producer: COMMITTED AND DEPLOYED, NOT ACTIVATED.**
Committed at `db4ebc28…`: `scripts/analysis/cycle_heartbeat.js` (NEW) plus two
worker-owned cycle-completion emit points in `arb_volatility_monitor.js`.

**It deployed ITSELF.** The volatility wrapper re-launches the monitor from the
repository path on every ~30s cycle, so the new bytes ran on the next cycle with
**no restart, no signal and no deploy command**. First heartbeat observed
2026-09-05T06:41:14Z — session-bound to `20260904_2239`, schema 1, build
`volatility-hb-build-0455a658`, `workerPid` already exited (correct for a
one-shot).

**The heartbeat is inert.** `health_contracts.json` is offline-only and nothing
consults it. Producer deployed != authority activated.

**M2E-016 shadow causal coverage: IMPLEMENTED, DECLARED, NOT ACTIVATED.**
A new authority form. Every prior output authority ages the OUTPUT; this one
ages the WORK. The deadline is anchored to the required record's own `ts`, never
to output age, so a quiet activator cannot age shadow into failure.

```
requiredWork   activator.jsonl, parseable JSON, type=signal signal=EXECUTION_READY
workKey        session + chain + block   [block RATIFIED M2E-013A: 2515/2515
               present, strictly monotonic, zero collisions, zero extras]
coverageLegs   v1 + v2 ledgers, ALL_REQUIRED
states         PASS · PENDING · ASYMMETRIC · FAIL · UNKNOWN
deadline       processingDeadlineSec 360   reReadDelayMs 250   attempts 1
```

**ASYMMETRIC is a distinct non-failing state, not a PENDING alias.** 35 of 35
measured samples showed a 2.17-5.80s window where one engine covers before the
other — the sequential-engine race. Immediate failure there would false-red on
essentially every new work item.

**Full fingerprint stability is mandatory** — existence + size + mtime_ns +
sha256. A v2 rewrite was observed changing content while holding EXACTLY
2,604,110 bytes, twice in one hour. Length alone is permanently rejected.

**EMPTY_FILE_TRANSIENT_CANDIDATE:** `fs.writeFileSync` truncates to zero before
writing (observed 2,142,199 -> 0). A read in that window sees an empty file that
parses cleanly as "zero covered work" — a confident, wrong answer with no parse
error. Zero bytes must pass the bounded re-read before meaning anything.

**Activation is a SEPARATE gate and is BLOCKED** by SHADOW-SILENT-FAILURE.

**M2E-008 fetcher heartbeat producer: DEPLOYED, EMITTING, NOT ACTIVATED.**
`scripts/fetcher_heartbeat.js` (NEW) plus a hash-gated emit point in
`scripts/master-fetcher.js`. It **self-deployed within 30 seconds** of the patch
landing on disk — first heartbeat 2026-09-06T04:08:38Z, session `20260904_2239`,
`producerBuild fetcher-hb-build-928a76e6`, 12 sub-fetchers attempted, 12 ok.

**No fetcher heartbeat CONTRACT exists**, so nothing evaluates this artifact.
`heartbeatStaleSec 300` is RATIFIED; `heartbeatStartupGraceSec` is UNRATIFIED
and no number will be invented from steady-state cadence.

**The SKIP GUARD fired in production before the first emit.** A lock-held cycle
resolved `{}` — which reaches `.then()` normally — and the producer declined to
claim completion, logging `heartbeat NOT emitted`. Without that guard the cycle
would have written `cycle:"complete"` with ZERO fetches. Because the Redis lock
is `SET NX PX`, one hung holder would have produced a healthy-looking 60s
cadence indefinitely: Incident 023's failure shape reproduced inside the
heartbeat layer.

**M2E-006 volatility heartbeat: ACTIVATED.** `heartbeatActivation` is now
`ACTIVE`, making the authoritative set exactly **{heat, volatility}**. The other
six remain `PENDING_MIGRATION`. Volatility becomes the SECOND component able to
reach `HEALTHY / CERTIFIED 3/3`, and the first whose heartbeat is session-bound
rather than pid-bound.

**The contract declares**
`sessionBound true · pidBound false · schemaVersion 1 · cycle "complete" ·
requireTs true · staleSec 180 · startupGraceSec 240`. Three evaluator blockers
found in M2E-002 are closed: pid comparison is per-contract, `workerPid` and
legacy `pid` are both understood, and `sessionId` is ENFORCED rather than merely
recorded. Two further activation blockers closed in M2E-004A: a non-`complete`
cycle can no longer pass on freshness, and future `mtime`/`ts` are rejected with
ZERO allowance — `mtime > now` is not fresh, it is wrong.

**One deployed file differs from git, deliberately:**
`scripts/tools/volatility_divergence_report.js` carries the M2-C heat heartbeat
producer at `6f623cca…`; git holds `a63b15db…`. `git status` **will** show it
modified. That is expected, not drift. Eight untracked research/telemetry paths
are **preserve-only**.

## 4. GOVERNANCE STANDARDS

```
TIME-001     UTC is canonical for ALL input, storage, logic, evidence and
             correlation. CT (America/Chicago, never hard-coded CST) appears
             ONLY at the notifier/operator presentation edge.
             Every local-time query must show its conversion inline —
             journalctl and date -d assume LOCAL unless told otherwise, and
             that silent assumption cost a 5-hour investigation error.
DEPLOY-SEM   every directive touching a potentially self-reloading component
             must classify its commit/deployment semantics:
               AUTO_ON_NEXT_CYCLE   a wrapper re-launches the worker from the
                                    repo path, so COMMITTING IS DEPLOYING
               RESTART_REQUIRED     a long-lived process must be restarted
               UNKNOWN              FAILS CLOSED — treat as live and gate it
             Classifications — PROVEN only where observed:
               volatility        AUTO_ON_NEXT_CYCLE   PROVEN (M2E-001-R7)
               fetcher           AUTO_ON_NEXT_CYCLE   PROVEN (M2E-008C: a
                                 heartbeat carrying the post-patch producerBuild
                                 and the current session appeared within 30s,
                                 with no restart, signal or manual execution).
                                 Upgraded from UNKNOWN by OBSERVATION, never by
                                 analogy to volatility.
               shadow_engine     UNKNOWN — same reasoning
               activator         UNKNOWN — same reasoning, and its wrapper is
                                 long-lived with adaptive backoff, so the worker
                                 and wrapper may classify differently
               heat              RESTART_REQUIRED  PROVEN (M2-C required a
                                 controlled stop/start to load new bytes)
               notification_router  RESTART_REQUIRED  PROVEN (RTR-004-R2: the
                                 instrumentation armed only after a new process)
               monitor           UNKNOWN — never characterized
               allmight_watchdog.sh  RESTART_REQUIRED  PROVEN (RTR-002C/D), and
                                 editing it beneath a running bash process risks
                                 mid-loop byte-offset corruption
             UNKNOWN fails closed: treat as live and gate it. Upgrading an
             UNKNOWN requires observed evidence for THAT component, never
             inference from a similar launch shape.
GOV-CHK-001  every commit changing meaningful state must refresh this
             checkpoint IN THE SAME COMMIT, and must be followed by a RAW
             GITHUB read (raw.githubusercontent.com or the REST API). A local
             read does not count. A commit report is incomplete without:
               checkpoint updated YES · raw GitHub verification PASS ·
               local HEAD == remote YES
             The verified set must cover EVERY path in the commit. Derive it
             from `git show --name-only`, never from a hand-kept list — R6
             verified three of four paths because the list was manual.
             Verify GIT BLOB vs RAW at the pinned commit; a bundle-artifact
             hash is NOT a repository hash.
```

## 4b. GOVERNANCE EVENT — components.json ENTERS GIT (M2E-005R1)

`scripts/telemetry/components.json` entered the repository in this commit as the
**exact frozen M0 baseline**, byte-identical at
`81bdb023cb939bd6d7c366183dc0cf8469b3f21dad6c03c5c5bebe5b9af7cacd`.

**Why now:** it is required by the minimum executable evaluator/test closure.
`m2e004_activation.test.js` cannot run without it, and a committed test that
cannot execute is the looks-verified-but-isn't class this project exists to
remove.

**Repository admission does NOT unfreeze it.** Its governance status remains
**FROZEN M0 BASELINE**: no edits, no normalization, no reformatting, no field or
semantic changes. Until this commit it had lived only in verification bundles
and Drive for the entire M0→M2E redesign — carried forward by hash, never by git.

Admitted alongside it, and only as a real module dependency of both
`registry_loader.js` and `health.js`: `scripts/telemetry/providers.js`. That is
a dependency admission, not a broader supervisor-tree migration.
`observe.js`, `state.js`, `evidence.js`, `runtime_adapter.js` and
`registry_validator.js` remain OUTSIDE the repository.

## 5. WHAT IS CLOSED

```
S9–S15R7   canonical integration; provider reconciliation; SID collision guard;
           signal observer; volatility --log routing; router exit instrumentation
M0–M2-D-R4 supervision redesign, OFFLINE: registry (FROZEN 81bdb023…),
           three-signal health model, canonical vocabulary, coverage model,
           typed providers, activation gating, empty-set semantics.
           17 suites, 282 checks, 3× stable from clean extraction.
M2-A→D     heat worker-owned heartbeat: designed, deployed (Option B),
           ACTIVATED. heat earned HEALTHY/CERTIFIED 3/3 from LIVE evidence —
           the first component to do so. Headline 1/8 HEALTHY.
SEC-001    41-byte credential committed to a public repo — ROTATED, inert
RCV-1/1A/2 Git docs/ recovery tree; Drive snapshot f29f8aa1… proven by
           exact-byte read-back; repo measured at 6.58 MB — broad pruning
           NOT JUSTIFIED, RCV-003 on HOLD
INC023-001 characterization: FOUR components record wrapper pids, not two —
           fetcher, activator, volatility, shadow_engine. Three currently show
           `bash -> sleep`, so `kill -0` succeeds during normal idle when NO
           worker exists. The watchdog inherits this for half the stack.
M2E-000    heartbeat semantics design accepted. RULING A: a wrapper-written
           completion record is auxiliary evidence, NOT heartbeat authority —
           the one-shot WORKER emits at its own cycle end. RULING B: activator
           needs conditional authority (RUNNING vs COOLDOWN) and is deferred.
           Order: volatility, fetcher, shadow_engine, activator.
INCIDENT 022  watchdog matched `notifier)` while the pid key is
           `notification_router`, so it detected the death and dispatched
           NOTHING, silently. Source fixed, committed, and DEPLOYED via a
           controlled restart. CLOSED.
```

## 6. WHAT IS OPEN

```
INCIDENT 021  R-SIGINT mechanism PROVEN ×2 (412s and 2130s uptimes).
              Sender UNKNOWN and RETROSPECTIVELY UNRECOVERABLE: no auditd,
              /proc exposes no sender, and corrected journal windows show no
              sshd/logind/kill at either instant. Signal-context
              instrumentation is COMMITTED and ARMED.
              STATUS: PASSIVE OBSERVATION. Do not spend slices. A deliberate
              SIGINT would not answer the historical question and is not
              authorized. If a third occurs naturally, preserve the enriched
              record and bring it back.
SHADOW-SILENT-FAILURE  OPEN AT RUNTIME. Source repair CANDIDATE verified but
              NOT COMMITTED, see 6b.
              The DEPLOYED launcher still runs both engines under
              `2>/dev/null || true`, so stderr is DISCARDED and a non-zero exit
              is SWALLOWED. Both engines can fail every cycle, forever, with no
              trace. The wrapper also SLEEPS FIRST, so for the first 300s of a
              session `kill -0` reports a healthy component that has never run.
              This BLOCKS any shadow authority activation: output proves work
              LANDED; it says nothing about a cycle that died before writing.
              DEPLOY_SEM(start_all.sh)=RESTART_REQUIRED, so a committed source
              fix does NOT remediate the running process. Restart/deploy is
              separately unauthorized.
INCIDENT 023  STILL OPEN. Volatility now has a worker-owned, session-bound
              heartbeat that detects worker death independently of its wrapper
              pid — but the PID ENTRY IS STILL THE WRAPPER and `kill -0` still
              tests a shell. The DUAL model mitigates volatility; it does not
              repair the pid namespace for any component.
              FOUR components record WRAPPER pids, not two — fetcher,
              activator, volatility, shadow_engine (INC023-001, live-confirmed).
              `kill -0` tests a subshell whose job is to survive the worker
              dying. THREE of them currently show `bash -> sleep`, so the check
              succeeds during normal idle when NO worker process exists at all.
              The watchdog reads the same pid file and inherits this for half
              the stack. heat, monitor and notification_router record their
              WORKER directly and are NOT affected; watchdog is legitimately a
              shell and is not an instance.
M2-E          IN PROGRESS. M2E-001 volatility producer COMMITTED (db4ebc28…)
              and DEPLOYED — it self-deployed on the wrapper's next cycle.
              NOT ACTIVATED: heartbeatActivation stays PENDING_MIGRATION and no
              evaluator consults the artifact. Next: the session-bound /
              PID-unbound activation contract. fetcher, shadow_engine
              and activator not started. Activator BLOCKED on the conditional-
              authority model gap.
PARKED        Dependabot 124 findings incl. 1 CRITICAL
              on a public repo · TIME-001 implementation · RCV-003 HOLD
              hygiene: execution_gate_score.js.pre-nan.bak (0 refs) and narrow
              history sanitization of the rotated secret
```

## 6b. M2E-017C — SHADOW SILENT-FAILURE SOURCE REPAIR CANDIDATE
##      (VERIFIED · NOT COMMITTED)

```
STATE          source repair CANDIDATE verified; NOT COMMITTED; runtime not
               remediated. The canonical repository source at
               scripts/tools/start_all.sh REMAINS THE PREIMAGE 27e8b93... until
               a successful Phase B commit.
               Running wrapper NOT restarted; runtime remediation PENDING.
               SHADOW-SILENT-FAILURE remains OPEN as a RUNTIME condition.
               DEPLOY_SEM(start_all.sh) = RESTART_REQUIRED.

LANGUAGE LAW   "Canonical source silent-failure mechanism repaired." is allowed
               ONLY AFTER a successful commit. Before that, the only accurate
               phrasing is "source repair candidate verified; NOT COMMITTED".

THE CHANGE     one launch block. `2>/dev/null || true` removed from BOTH engine
               invocations; each exit captured and reported as
                 [shadow_engine] ENGINE_EXIT engine=<v1|v2> rc=<n>
                                 session=<session> ts=<UTC Z>
               PRESERVED: set +e · v1/v2 independence · unconditional `true` at
               loop end · `sleep 300` first · SHADOW_PID recording · production
               trailing `&` · log destination.
               diff scope: ONE hunk, +30/-2, shadow launch block only.
               No heartbeat implemented. Shadow output stays PENDING_MIGRATION.

HARNESS — THE LESSON OF THIS SLICE
               A-2 ran the bundle harness unmodified and it FAILED 24/3.
               Cause was NOT the candidate. The harness backgrounded the
               synthetic cycle and read the log after a FIXED `sleep 0.3`;
               the v2 ENGINE_EXIT is the last write of a cycle, so on a loaded
               machine it landed after the read. S4/S9/S21 all consumed that ONE
               capture. Shortening only the settle interval reproduced the exact
               three-failure signature against a byte-identical candidate.
               CONSEQUENCE: the earlier "27/27 x3" of the ASYNCHRONOUS harness is
               NON-CERTIFYING historical evidence. It was a race that won three
               times. A suite whose result depends on machine load certifies
               nothing under an x3 determinism standard.
               A-3 REPAIR: extend the existing mkfix transformation so the
               synthetic one-cycle fixture runs in the FOREGROUND. The race is
               removed BY CONSTRUCTION, not by widening a delay.

TARGET-MACHINE RESULTS (A-3, 2026-09-06)
               repaired harness   27/0 x3 EXACT, clean extraction each run
               zero-delay control 27/0  -> TIMING_INDEPENDENCE = PROVEN
               all four logs byte-identical once timestamps are stripped
               candidate bash -n PASS · harness bash -n PASS
               shipped diff truthful YES · target path collisions NONE
               runtime restart NO · signal NO · repo mutated NO

PORTABILITY    the bundle-layout harness must NOT be committed verbatim. The
               canonical harness resolves
                 P="$HERE/../../scripts/tools/start_all.sh"
                 B="$HERE/fixtures/m2e017_baseline_start_all.sh"
               and COMPUTES the S17/S18 scope diff from baseline vs candidate in
               scratch. The bundle dependency on ../staging/m2e017.diff is GONE;
               no sixth path carries a committed diff.
               Verified from the ruled layout: 27/0 x3, zero-delay 27/0,
               bash -n PASS, computed diff payload IDENTICAL to the retired
               m2e017.diff, and S17/S18 mutation-proven DISCRIMINATING —
               S17 fires only on another component's launch change, S18 only on
               a SHADOW_PID change, both pass unmutated.

PRESERVED      tests/tools/baseline_start_all.sh
               27e8b9367788f2268513f203d5770b49f0ea6026ed229031bc9123e49f558f0c
               UNTRACKED, content-identical to the canonical fixture but
               PATH-DIVERGENT. Preserved in place; NOT renamed, deleted,
               overwritten or staged; NOT part of the five-path commit set.
               Disposition deferred to a separate cleanup ruling.

INSTRUMENT DEFECTS CPT SELF-REPORTED IN THIS SLICE
               find -maxdepth 2 could not see bundle artifacts at depth 3
               a keyword filter matched the DIRECTORY "test/" and mistook the
                 fixture for a runner
               a suite counter matched "PASS" while this harness prints "OK" and
                 a "passed N failed M" summary — it reported 0 passes for a
                 suite that had passed. Test labels are part of the test; read
                 the harness's own summary, never a vocabulary you invented.

HARD LOCKS     unchanged. No restart, signal, reload, deploy, broadcast,
               signing or capital movement is authorized by this checkpoint.
```

## 7. THE ARCHITECTURE

```
THREE INDEPENDENT AUTHORITIES
  process    is the pid alive?      heartbeat  is the loop turning?
  output     is work landing?
TWO SEPARATE VERDICTS
  controlState  PASSING|DEGRADED|FAILED|UNKNOWN     — never HEALTHY
  healthState   HEALTHY|PARTIAL|UNVERIFIABLE|DEGRADED|FAILED|UNKNOWN
  reduce() cannot emit HEALTHY; healthVerdict() is the sole producer and
  requires every required authority ACTIVE and passing. One field is safe alone.
ACTIVATION GATE   a DECLARED signal is not a FAILURE AUTHORITY until its
  producer is proven deployed. PENDING yields NOT_APPLICABLE, never FAIL.
EMPTY SET   NO OBSERVATION YET != STALE != FAILED. An empty set has no
  timestamp to age, so the SESSION is aged instead.
HEARTBEAT OWNERSHIP  a heartbeat must be produced by the WORKER whose liveness
  it claims. A wrapper outlives its worker by design. For a ONE-SHOT worker the
  worker emits a CYCLE-COMPLETION record at its own cycle end, before exiting;
  a wrapper-written record is auxiliary evidence only (Boss Ruling A).
  The guarantee is NOT that workerPid/producerBuild/sessionId are unforgeable —
  a wrapper could write anything. It is that the only AUTHORIZED emitter call
  site is inside the worker-owned path, and no wrapper has one.
SESSION AUTHORITY  heat binds its epoch via the PID check, because its pid file
  records the long-lived worker. That is UNAVAILABLE for one-shot-under-wrapper
  components: a new pid every cycle, and the pid file records the WRAPPER. Those
  carry an explicit sessionId read FRESH per emit from logs/allmight.session.
  At activation: session-bound = true, PID-bound = false. A 180s stale window
  (4x the 30s wrapper cadence) is PROPOSED ONLY and is NOT ratified.
```

## 8. RULES EARNED THE HARD WAY

```
1  Enumerate before normalising.
2  Run the counterfactual before excluding.
3  "No rejection" != "positive evidence".
4  Test the property, not the name of the test.
5  A zero-result probe must prove it can hit a known positive first.
6  Test what you claim — a skipped file is not an inspection.
7  Component evidence first, aggregates derive. Never edit a count to go green.
8  Producer deployed != authority activated.
9  Observation is not authorization.
10 Never patch from a cached reference — read the deployed file first.
   (CPT's tree was stale TWICE; hash-gating caught both before damage.)
11 One action per slice. Every stop returns evidence and never repairs.
12 A MANIFEST must be GENERATED from the bundled bytes, never transcribed.
   M2E-004A shipped a stale health.js hash because it was typed; the rebuild
   computes every SHA at build time and re-verifies them against the finished
   archive.
13 An UNRATIFIED tolerance is a defect. A 5s future-time window was imported
   from the session-pointer guard, where filesystem granularity justified it;
   it did not transfer, and any window is a gap a touched artifact passes
   through. Carry a constant only where its justification carries too.
14 CLASSIFY A RETROFIT ITEM BY WHAT MADE IT FAIL. If a fixture stopped
   supplying required evidence it is a SUPPORT change, even when a count moves
   as a downstream consequence. Counting it twice inflates the ledger and hides
   whether every original item was addressed exactly once.
15 A LABEL IS PART OF THE TEST. Four test titles claimed PENDING while their
   assertions correctly checked ACTIVE. Three successive greps each missed at
   least one; a structural sweep comparing every label against its own body
   found all four. A pattern that cannot see the whole structure is a guess.
16 ABSENCE OF EVIDENCE IS NOT EVIDENCE OF A DIFFERENT MECHANISM. When the
   fetcher heartbeat had not appeared, the correct verdict was DEPLOY_SEM
   UNKNOWN — not RESTART_REQUIRED. The producer deliberately emits nothing on
   the lock-held, empty, null and fatal paths, so absence was consistent with
   CORRECT behaviour. Only a positive observation could upgrade the claim.
17 A REDIS NAMESPACE IS NOT OWNED BY ITS NAME. `fetcher:*` keys can be
   refreshed by volatility, which calls runFetcher() on its own cycle. Key
   freshness therefore cannot serve as fetcher output authority; only a
   payload carrying producer and session identity can.
18 CLASSIFY A TEST FAILURE BEFORE FIXING IT. A = real implementation defect,
   B = intentional declaration-epoch drift, C = unrelated. M2E-016 broke 9
   suites; 2 were real defects (unresolved $SESSION_DIR in multi-path sources)
   and 5 assertions were epoch drift. Retrofitting first would have blessed
   expectations around a still-broken implementation.
19 VERIFY BY PATH, NEVER BY BASENAME. A manifest check using `find -name`
   matched test/refs/runtime_adapter.js instead of the staging copy and
   reported a false mismatch. The same class as the four stale test labels.
20 A test must be PORTABLE. console.log passes through a formatter that can
   inject ANSI escapes; parsing it as a number yields NaN and fails a CORRECT
   implementation. Prefer machine-readable output, and better still verify
   from the ARTIFACT rather than from stdout.
```

**For any future CPT session:** roughly a dozen *measurements CPT wrote* were
wrong while the system was fine — `pgrep -c … || echo 0` fabricating counts,
`\s` in POSIX awk, scans matching their own comments, UTC values passed to
local-time queries. **The system's own instruments were right every time.**
Prefer `start_all.sh status`, `git ls-remote`, a component's own stdout. When
writing a custom probe, prove it can fire before trusting its silence.

## 9. OPERATIONS

```
deploy    Cornelius's browser saves to ~/Downloads. ALWAYS give an explicit
          `cp ~/Downloads/<file> <dest>`. Never say "place" or "drag".
          Verify the download landed (sha256sum) BEFORE running — four stops
          this session were a missing ~/Downloads file, not a defect.
evidence  operator uploads logs to ~/Uploads/
git       explicit path staging only. No `git add -A`, no `commit -a`.
          Guards abort before staging and reset on late failure.
bundles   must reproduce from clean extraction; include unchanged reference
          files they depend on and list their SHAs
shell     never paste a heredoc-defined function containing `exit` into an
          interactive shell — it closes the terminal. Write to a file, run it.
```

## 10. KEY HASHES

```
M0 components.json (FROZEN)   81bdb023cb939bd6d7c366183dc0cf8469b3f21dad6c03c5c5bebe5b9af7cacd
notification_router.js        b8d46a3e0ff922ca6657fe88cc9413e5c296e6acf5105e5518454fac7011eaf5
signal_context.js             87b3054a7bbf0eec44ced4a20139d39e79439497a5697c3c65709db2698d7ae1
allmight_watchdog.sh          082f6da800896f5b80bf0fd911cf8342451740ea5c4b371e182c4500b73fac7a
heat producer (deployed)      6f623cca514c12aca2c027095a934b1ae3ccc22975901e6fd8448b30fe3903c4
heat producer (git)           a63b15db005fd004dd4e19ff661bc155b215b49c7e506ced449f65be972f57f3
heartbeat producer build      heat-hb-build-5de9d400
cycle_heartbeat.js            7ca2a401567a460f093c6d16d537702cf86923fa9504a4f0034547d1fe070019
M2E-001 test (REPOSITORY)     6470c14f2d616c50e28543d14a49719cb241f569dda8e30de100d99693695cf0
  NOTE d511f73d… is the BUNDLE-ARTIFACT hash; the committed file has its module
  paths rewritten to scripts/analysis/ and is the one that runs from the repo.
volatility monitor (DEPLOYED) 38799103b615ea34d3e85e1081795d4ec0c2fe85ceeceb64f767d19ccef0b0b0
M2E-001-R4 bundle             dac2173f7d79920f722f4f3fcba2ada17b52a6312d58d66d078be0d2cd61edb9
first volatility heartbeat    2026-09-05T06:41:14Z  session 20260904_2239
M2E-001-R4 result             28/28 x3, and 28/28 under FORCE_COLOR=1
volatility monitor (pre-M2E)  0455a658db36863da761f680ca2448cd56decff12fc925fbe182bfa7403d0874
volatility producer build     volatility-hb-build-0455a658
fetcher_heartbeat.js          d1211578a0ba60b0d875d27ac2d6ca0a920386b7f7fb1ea1c56f3eaf82102370
master-fetcher.js (pre-M2E)   928a76e6483ebe44103793dbaa0457092795212398bbb42bcd2a4fbeac8ac933
fetcher producer build        fetcher-hb-build-928a76e6
fetcher cadence (measured)    60-73s over 12 natural cycles (M2E-007-R1);
                              staleSec 300 RATIFIED, startupGrace UNRATIFIED
M2E-008A bundle               b36a7c6bfed27e0eb6e2393f783369af92954678dee356fa5d55214c327500ba
M2E-016D bundle               bc503ca3df7bb236fa034c2af34bd08fe1f4b2b64de2c63b2db364834b4824d9
M2E-016 regression            19 suites / 366 checks, 3x from clean extraction
shadow cadence (measured)     11 intervals, median 306s, max 311s
shadow causal latency         35 distinct samples, median 142.3s, max 307.6s
shadow rewrite window         12 events, max 92ms; zero-byte exposure 35ms (n=1)
volatility cadence (measured) 30-31s over 24 consecutive cycles (M2E-003A);
                              staleSec 180 ~= 6 nominal cycles, startupGrace 240
M2E-004A bundle               476ba19552ce3fdc778eb82a9b6f34ed82aa1461caf6e2397cd84fa41e06c67e
components.json (FROZEN M0)   entered git M2E-005R1 at scripts/telemetry/
                              81bdb023cb939bd6d7c366183dc0cf8469b3f21dad6c03c5c5bebe5b9af7cacd
M2E-006R4 bundle              b2f8ff0046a4d89670951e477e1a812614066566dc428182e27e34f89187422c
M2E-006 regression            18 suites / 313 checks, 3x from clean extraction
                              312 + 1 new control (A11b). The count was NOT
                              forced back: test meaning outranks the integer.
M2E-006 epoch retrofit        28 failing assertion instances from 19 distinct
                              causes: CLASS A 13, CLASS B 6, CLASS C 0
heartbeat payload schema      heartbeatSchemaVersion 1
Drive pre-prune snapshot      f29f8aa19d9d1ff5a1bda77715a6daa0880c31953a4e548505d5cee1620cb1c5
M2E-017 launcher preimage     27e8b9367788f2268513f203d5770b49f0ea6026ed229031bc9123e49f558f0c
M2E-017 candidate launcher    0364dd3961dff5b0547c034cb306164c07915a9a233e9b9485fdcfe6a39c409c
M2E-017B bundle               8da4916837eed70f11609d1d5cd30df134eb78a5197387fe8e0d272bde0f836f
M2E-017 harness (bundle)      0f30af7cda3561478a8642bc32b1f1679cb041f7e3197326f111626b14681a8b
  NON-CERTIFYING. Asynchronous fixture; its x3 result was timing-dependent.
M2E-017 harness (A-3 repair)  2dfa650f2567ee67d431208101b111f45805ee08b7d546a6f48dd3eae2d45d85
M2E-017 harness (CANONICAL)   f2b68dade557e4ffec6a7398b360b7048ef18d6b2a08b4be37290af9bd748a37
  at tests/tools/m2e017_silent_failure.test.sh · 27/0 x3 · zero-delay 27/0
M2E-017 canonical fixture     27e8b9367788f2268513f203d5770b49f0ea6026ed229031bc9123e49f558f0c
  at tests/tools/fixtures/m2e017_baseline_start_all.sh (bytes == preimage)
W11 lessons (governance)      bb56a2ac8f5ea89e0e4a9b9fad1ab0072cebde46924476a868fe865c79050b62
checkpoint base for M2E-017C  aa682b9a2011def87e71370992aab78d9d3fd2f752aa13b4a7039f31376b60aa
M2E-017B checkpoint delivery archive
                              195e6968fdc73df8ff05cbfa0d1cb1fcbe4d349a17dba2ba9ee515b5b4f8c5c5
  SHA256 of the delivery archive W11_CHECKPOINT_M2E017.zip; NOT a
  checkpoint-document hash. Do not search for a document with this hash.
  HISTORICAL EVIDENCE ONLY. Not a restoration target.
```

## 11. THE EXACT NEXT AUTHORIZED ACTION

**Return to Boss for review.** This checkpoint is the deliverable; no further
work is authorized by it.

M2E-017C has verified a source-repair CANDIDATE and a deterministic canonical
harness (§6b); **Phase B remains unauthorized.** The candidate is NOT COMMITTED
and the canonical repository source is still the preimage. **Staging, commit and
push of the five-path set has NOT been started.** The expected
set, if later authorized, is exactly:
`scripts/tools/start_all.sh` · `tests/tools/m2e017_silent_failure.test.sh` ·
`tests/tools/fixtures/m2e017_baseline_start_all.sh` ·
`docs/recovery/PROJECT_RECOVERY_CHECKPOINT.md` ·
`docs/governance/ALLMIGHT_LESSONS_LEARNED_W11.md`. No sixth path.
**Source repair is not runtime remediation.** No restart is authorized.

The volatility migration is COMPLETE. SHADOW has a declared, dispatched, INACTIVE
causal output authority; its activation is blocked by SHADOW-SILENT-FAILURE and
it still needs a heartbeat for idle liveness. The FETCHER producer is deployed
and emitting but has NO contract and NO activation — those are separate gates that
have not been released. **Nothing further is released** — fetcher,
shadow_engine and activator have not been started, Incident 023 remains open for
the pid namespace, and Dependabot, TIME-001 implementation, RCV-003 and
economics all remain parked.

**Ask Boss for the current directive rather than resuming from this section.**

Nothing beyond that is released. Incident 021 is in passive observation;
fetcher/shadow_engine/activator heartbeats, Dependabot, TIME-001
implementation and economics all remain parked. **Ask Boss for the current
directive rather than resuming from this section.**

## 12. WHAT A FRESH SESSION DOES FIRST

```
1  read this checkpoint
2  verify:  git rev-parse HEAD · git ls-remote origin refs/heads/main
            bash scripts/tools/start_all.sh status · cat logs/allmight.session
3  if reality disagrees with §3, REPORT IT — do not reconcile silently
4  ask Boss for the current directive
```

**STOP.**

---
---

# ══════════════════════════════════════════════════════════════════
# M2E-017G SUPERSESSION OVERLAY — AUTHORITATIVE CURRENT STATE
# ══════════════════════════════════════════════════════════════════

**Appended:** 2026-09-10 (M2E-017G) · **Authority:** Boss R80K · **Standard:** GOV-CHK-001

> **EVERYTHING ABOVE THIS LINE IS PRESERVED CANONICAL HISTORY.**
> It is retained verbatim for audit and recovery history. Where it describes
> operational state, it is **SUPERSEDED** by this overlay. Nothing above has been
> deleted, reordered or rewritten.
>
> **PRECEDENCE — running machine > repository > this document > chat memory.**
> That rule from the header above is unchanged and still governs.

## S1. SUPERSEDED OPERATIONAL SECTIONS

| Section | Historical statement | Status |
|---|---|---|
| **§3 CURRENT RUNTIME** | `session 20260904_2239`, `stack 8/8 non-live`, router pid 1668840 ARMED, watchdog pid 1668839 running | **SUPERSEDED** — see S2 |
| **§6 WHAT IS OPEN** | runtime conditions stated against a running stack | **SUPERSEDED IN OPERATIONAL MEANING** — the defects remain open; the runtime they describe no longer exists |
| **§11 NEXT AUTHORIZED ACTION** | M2E-017C Phase B commit not started; five-path set | **PARTIALLY SUPERSEDED** — see S6. Phase B remains unauthorized; the M2E-017C candidate WAS subsequently committed (see S2) |
| **§12 FRESH SESSION** | step 2 instructs `bash scripts/tools/start_all.sh status` | **SUPERSEDED** — see S7. **Do not invoke the launcher.** |

## S2. CURRENT MACHINE STATE — OBSERVED 2026-09-10T04:13:16Z

```
canonical HEAD        923dd5041e645c22ad025a3f8335a03880f89b99
origin/main           923dd5041e645c22ad025a3f8335a03880f89b99   (in sync)
governed runtime      INTENTIONALLY QUIESCENT FOR CERTIFICATION
historical baseline   0/8 present   (all eight original PIDs absent)
governed role hits    0
maintenance window    OPEN
restart               NOT AUTHORIZED
```

The M2E-017C source repair described in §6b **was committed**; HEAD `923dd504…` is
that commit. The canonical launcher is now `0364dd39…` (the §10 "candidate"), no
longer the preimage `27e8b93…`.

**How the runtime became quiescent** — a deliberate, evidence-gated maintenance
shutdown, not a failure:

```
R72   drift reset: uptime preservation abandoned in favour of a clean window
R76   five surviving roots stopped by identity-validated SIGTERM, exact PIDs
R77   one orphaned activator worker (2560704) stopped, same discipline
      GOVERNED_RUNTIME_STATE=QUIESCENT_FOR_CERTIFICATION
```

No SIGKILL, no launcher, no broadcast, no capital movement at any point.

Canonical control files remain **unchanged and stale by design** — the pidfile
still carries its eight original mappings and was deliberately not edited:

```
logs/allmight.pid                    2899bbf5be90879de6229e28fb306ade8f370d1fdba47b94701b04b7eeadb3c1
logs/allmight.session                d92e2b5c2f319499e6201c601f998e46be264139dd2dd508c9907d6169aeecbb
logs/notification_router.exit.jsonl  b59ae10c118b0ab3d1d3fee7af147ba9fe9b02fadfac24ce8fd7cdc9e8077671
```

## S3. CURRENT EXECUTABLE IDENTITIES

| Component | SHA256 | Status |
|---|---|---|
| development executor | `583cfdbc4dff6a3351136dc98257f19ed1c2735348c6eb553c2ee8e66d50eae7` | **NOT CERTIFIED** · never committed |
| prior certified executor | `e1f1cca7481a48b33e9a501a57a57359aa07ebb1f647998353c939fcb30eb918` | bytes **UNAVAILABLE** |
| SP01 hook (host-bound) | `fcbb957cf6fb789c7987305d7510449019bb8d78daa4e43c793fdcf1e6cfb4bf` | accepted R78/R79G |
| historical hook | `4ef4b9498b3e989e565d1088e3f8244f1fd92eb0b0aca1b40a72b9fe56a29010` | preserved, superseded |
| P1 parse_stat | `7c85e0a5d5813326979aef8e7fe6ecd049ae16f8bc1e780a57c441ac5e344f04` | CERTIFIED |
| P2 walk_ancestry | `2d99c4d7b12eb83348acf672f201c0815c26f9af21c9b32e11a31e458c5d3d95` | CERTIFIED |
| P3 lineage_lifecycle | `a1777755c38f80feeb905c94f8d3f4f278ccd16440a2f10bf64a732a602ee0ec` | CERTIFIED |
| P4 ownership_predicates | `cc8b053ee9c95051947d516a8b0e0824f1dc2d35993ffd8a6743fe969380e52f` | CERTIFIED |
| P5 ownership_gate | `0b3998fa0338f5517bff95ada3e958ad0c05157f2de2ea304c8127da041e8c5e` | CERTIFIED |

## S4. R79 TOPOLOGY PROOF — PASS / CONSUMED

Evidence `fc63edb5b94bcd092cd524e7cc6a97a969dbd1748a536c6cd902bc9a5f096a6f`.
Detail: `docs/certification/M2E017G_R79_TOPOLOGY_PROOF.md`.

**PROVED** — G7 discovers and freezes the correct non-governed fixture descendant
through the executor's unmodified real `pgrep -P` parentage, under a
synthetic-baseline certification world, with governed selection count 0.

**DID NOT PROVE** — real teardown · real TERM delivery · SP01 · restart · launcher
behaviour · executor certification.

`PT_ROOT_SURVIVOR` occurred after all topology evidence was established and is
consistent with the adapter-injected ESRCH path. It **must not** be read as
successful teardown behaviour.

## S5. R80 CERTIFICATION SCOPE — ACCEPTED, NOT YET EXECUTED

Full A/I/D/S/C/T matrix from recovered R28 exact bytes:

```
A 4 + I 6 + D 6 + S 8 + C 8 + T 10 = 42
```

plus the mandatory R28 **SELF-LINEAGE / PROCESS-SELECTION REGRESSION**.

**T05-T10 are launcher-dependent** and remain `CURRENT_EXECUTION_AUTHORITY=LOCKED`.

Accepted governance authority (bytes archived under
`docs/governance/authority/m2e017g/`): **R28** (primary matrix) · **R29**
(fixture honesty) · **R30** (stop-propagation) · **R33** (authorization context) ·
**R40** (command-position / verifier consistency).

## S6. ACTIVE LOCKS

```
executor 583cfdbc...          NOT CERTIFIED
R80 host behavioral execution NOT AUTHORIZED
SP01 / SP02-SP05              NOT AUTHORIZED
restart                       NOT AUTHORIZED
launcher                      NOT AUTHORIZED
repo mutation                 NOT AUTHORIZED (this preservation commit excepted
                              only when separately authorized)
broadcast                     LOCKED
capital                       UNTOUCHED
economics                     PARKED   (unchanged from §2 above)
```

§11's **"No sixth path"** is scoped to the M2E-017C five-path source-repair commit
and is **not** a permanent bar on later documentation files (Boss R80K Ruling 2).
A documentation-only preservation commit is a separate, separately authorized act
and must bundle **no** executable or source change.

## S7. WHAT A FRESH SESSION DOES FIRST — SUPERSEDES §12

```
1  READ CURRENT MACHINE STATE FIRST.
2  GOVERNED RUNTIME IS QUIESCENT FOR CERTIFICATION.
3  DO NOT RESTART OR INVOKE THE LAUNCHER WITHOUT CURRENT BOSS AUTHORIZATION.
4  read this checkpoint, including the preserved history above
5  verify read-only:  git rev-parse HEAD · git rev-parse origin/main
                      ls /proc for the eight historical baseline PIDs (expect none)
   DO NOT run start_all.sh status — §12 step 2 is SUPERSEDED.
6  if reality disagrees with S2, REPORT IT — do not reconcile silently
7  ask Boss for the current directive
```

## S8. EXACT NEXT AUTHORIZED STEP

Boss review of the R80 pre-commit preservation review and proposed explicit-path
staging list. **Nothing is authorized to run on the machine.**

## S9. OPEN INCIDENTS AND DEFECTS

Full records: `docs/recovery/BUG_AND_INCIDENT_LEDGER.md`.

```
INCIDENT 021  OPEN / source-grounded — R-SIGINT sender unrecoverable; passive
              observation; instrumentation armed
INCIDENT 022  OPEN · STATE_CONFLICT=YES — the incident index records it OPEN with
              the accepted patch not applied; §5 above records it CLOSED via a
              controlled restart. UNRESOLVED. Treat as RESTART-BLOCKING until
              evidence resolves it.
INCIDENT 023  OPEN / source-grounded — four components record WRAPPER pids;
              three show `bash -> sleep`, so `kill -0` succeeds while no worker
              exists. Cross-linked to the wrapper-vs-worker liveness-proof class
              WITHOUT any claim of identical root cause.
INCIDENT 015  PARKED · SOURCE_EVIDENCE=NOT_RECOVERED
INCIDENT 020  PARKED · SOURCE_EVIDENCE=NOT_RECOVERED
BUG-004       ROOT_CAUSE_PENDING S2 — heat native V8 GC fatal CHECK; mechanism
              proven, underlying cause unresolved; REGRESSION_TEST=NOT_POSSIBLE
BUG-009       OPEN S1 — verifier-precision root class
BUG-010       FIX_VALIDATED S2 — T10 dropped from the transcribed matrix
BUG-011       FIX_VALIDATED S2 — stale manifest hash after ledger mutation
SHADOW-SILENT-FAILURE  source repaired at HEAD; runtime remediation still
              pending because the stack is deliberately down
```

## S9b. CANONICAL MERGE PROVENANCE

This checkpoint was produced by **exact-byte concatenation**, never transcription.
The canonical history above is the committed object, read via
`git show HEAD:docs/recovery/PROJECT_RECOVERY_CHECKPOINT.md`.

```
BASE_CHECKPOINT_SHA   87af009366a887640d1e84a98955c6aee195eddbc2fcbc2e887017cf94cd19f3
BASE_BYTES            34793
HOST_MERGE_PROOF      PASS      [Boss R80M]
BASE_PREFIX_MATCH     YES       first BASE_BYTES of merged file hash to BASE_CHECKPOINT_SHA
OVERLAY_SUFFIX_MATCH  YES       bytes BASE_BYTES+1..EOF hash to this overlay
CANONICAL_REPO_CHANGED_BY_MERGE_CONSTRUCTION   NO
```

**OVERLAY_SHA and MERGED_DESTINATION_SHA are deliberately NOT recorded here.**
A file cannot contain its own hash: embedding either value changes the bytes and
therefore changes the hash, with no fixed point. Both are recorded externally in
`docs/recovery/BUILD_AND_CERTIFICATION_LEDGER.md` and in the preservation-review
package manifest, and must be re-proven on the host whenever this overlay changes
(Boss R80N merge-SHA rule: never carry a stale merged SHA across an overlay
mutation).

## S10. DOCUMENT SET ADDED BY THIS PRESERVATION

```
docs/certification/M2E017G_EXECUTOR_BEHAVIOR_MATRIX.md
docs/certification/M2E017G_EXECUTOR_CERTIFICATION_HISTORY.md
docs/certification/M2E017G_R79_TOPOLOGY_PROOF.md
docs/certification/M2E017G_R80_RECERTIFICATION_PLAN.md
docs/governance/M2E017G_GOVERNANCE_AUTHORITY_INDEX.md
docs/governance/authority/m2e017g/          (11 immutable authority originals)
docs/recovery/BUILD_AND_CERTIFICATION_LEDGER.md
docs/recovery/BUG_AND_INCIDENT_LEDGER.md
```

**STOP.**


## S11. R80P COMMIT-BOUND PRESERVATION AUTHORITY — SUPERSEDES S8 / S9b / S10 WHERE CONFLICTING

This section is the current recovery authority for the documentation-preservation
transaction. Earlier S8/S9b/S10 statements remain historical evidence but are
SUPERSEDED where they conflict with this section.

### Current machine / preservation state

- Governed runtime remains deliberately QUIESCENT_FOR_CERTIFICATION.
- Historical baseline process count remains 0/8.
- Launcher, SP01, restart, behavioral certification execution, broadcast, and
  capital remain NOT AUTHORIZED.
- Existing unrelated dirty/untracked worktree paths remain preserve/do-not-touch.
- R80O fresh merge re-proof PASSED for base SHA
  `87af009366a887640d1e84a98955c6aee195eddbc2fcbc2e887017cf94cd19f3`
  plus pre-addendum overlay SHA
  `31408c1006471639ab6c49da1714de3b352f28de0159b5715e803a6ad33daf0c`.
- The resulting pre-addendum candidate merged SHA
  `1d9fd605c8a6c562eef4b75cb6fbaf0088cf99755c480a10906a381399901249`
  is historical proof only and becomes superseded when this addendum is appended.

### Documentation set

The preservation transaction contains 28 staged documentation files from the
accepted R80N package plus this merged checkpoint, for 29 canonical documentation
paths total. The package contains 21 immutable authority originals. Earlier S10
counts are historical and SUPERSEDED by these counts.

### Exact next authorized action

Boss R80P authorizes one bounded documentation-preservation transaction:

1. reconstruct the final overlay from the accepted R80N overlay plus this exact
   addendum;
2. re-prove base-prefix and final-overlay-suffix integrity;
3. compute the final overlay SHA, byte count, merged SHA, and merged byte count;
4. only if every preservation invariant passes, write the 28 reviewed staged
   documentation files plus the proven merged checkpoint to their exact canonical
   `docs/` destinations;
5. stage only the 29 authorized documentation paths;
6. prove no executable/non-document/unrelated dirty path entered the index;
7. commit once and push once;
8. verify local HEAD == origin/main;
9. derive the committed path set from `git show --name-only`;
10. verify every committed documentation file against pinned raw GitHub-served
    bytes at that exact commit;
11. STOP for Boss review.

No additional documentation refresh is required solely because R80P exists. R80P
is the commit-bound transaction authority and may be archived in a later governance
preservation cycle. This prevents recursive self-invalidation of the commit snapshot.

### Post-transaction recovery state

After a successful commit, push, and pinned remote verification, no launcher,
restart, SP01, behavioral certification execution, broadcast, or capital action is
automatically authorized. The exact next step is Boss review of the completed
preservation commit and remote-verification evidence.

**STOP after remote verification.**


---
---

# ══════════════════════════════════════════════════════════════════
# M2E-017G PRESERVATION OVERLAY 2 — POST-R80P CERTIFICATION STATE
# ══════════════════════════════════════════════════════════════════

**Appended:** 2026-09-12T00:53:58Z · **Authority:** Boss R80CB / R80CC
**Transaction:** `M2E017G-PRESV-002` · **Baseline HEAD:** `4133fd9dd5b84565c3903e85ef04c6d6325aa2f4`

> Everything above is preserved history, retained verbatim. Where it describes
> certification state it is **SUPERSEDED** by this overlay. Nothing above was
> deleted, reordered or rewritten. The final preservation commit SHA is recorded
> in the post-commit verification report, not embedded here — a document cannot
> contain the hash of the commit that carries it.

## P1. WHY THIS OVERLAY EXISTS

The first preservation commit `4133fd9d…` archived rulings **R28 → R80N**. The
arc then continued for a further **67 rulings** (R80O → R80CC) before this
transaction. A prior Boss context loss occurred during that window, and the
handover revealed the repository was ~49 rulings behind. This overlay closes
that gap and records the current controlling state.

## P2. EXECUTOR

```
executor                583cfdbc4dff6a3351136dc98257f19ed1c2735348c6eb553c2ee8e66d50eae7
certification state     NOT_CERTIFIED
bytes                   PRESERVE EXACT — no modification authorized
```

## P3. MATRIX — ACCEPTED / PASS-CREDIT (14)

```
A01 A02 A03 A04     I01 I02 I03     D01     S02 S03 S04 S05 S06 S08
```

## P4. BLOCKED CASES

Three distinct non-credit classes. BLOCKED_LAUNCHER_BOUNDARY is NOT a
reachability class: S07 *reached* its target behaviour and was stopped at the
launcher boundary, which is the opposite of unreachable. Boss R80CA/R80CD
require the classes to stay separate.

```
BLOCKED_REACHABILITY  7
  I04  NO_AUTHORIZED_G2_TO_G10_PROC_ROOT_MUTATION_SEAM
  I05  G9_EXCLUDES_BASELINE_ROOT
  D02  NO_AUTHORIZED_POST_G7_PARENT_DISAPPEARANCE_SEAM
  D03  PT_ROOT_SURVIVOR_PREEMPTS_DESCENDANT_VANISH_OBSERVATION
  D04  NO_AUTHORIZED_G7_TO_REVALIDATION_IDENTITY_MUTATION_SEAM
  D06  NO_AUTHORIZED_G7_TO_REVALIDATION_IDENTITY_MUTATION_SEAM
  S01  NO_AUTHORIZED_G2_TO_SIGNAL_ONE_ENTRY_MUTATION_SEAM

BLOCKED_LAUNCHER_BOUNDARY  1
  S07  see P5 — teardown behaviour demonstrated, stopped at canonical start

BLOCKED_CERTIFICATION_CONTRACT  2
  I06  P5_NOT_GOVERNED_CONFLICT
  D05  P5_NOT_GOVERNED_CONFLICT

TOTAL NON-CREDIT BLOCKED  10
```

## P5. S07 — FINAL DISPOSITION

```
S07  BLOCKED_LAUNCHER_BOUNDARY
     TEARDOWN_BEHAVIOR_DEMONSTRATED   YES
     CERTIFICATION_PASS_CREDIT        NO
     RERUN_REQUIRED_OFFLINE           NO
```

S07 is the only case to have cleared post-teardown proof. Its hook removed the
synthetic mirror, roots and descendants became absent, `PT_ROOT_SURVIVOR`,
`PT_DESC_SURVIVOR`, `POSTTEARDOWN` monotonic and `PT_CENSUS_NONEMPTY` all
cleared, the historical-session precondition was satisfied, and the executor
entered control-file transition and then the canonical start block at line 686.
The runner's 120 s timeout ended it there (rc 124) before any terminal
classification was emitted.

No pre-launch test-stop seam exists in the certified executor, and none is
authorized. S07 is closed for the offline arc.

## P6. NOT STARTED / LOCKED

```
C01-C08                NOT_STARTED   next technical item = DESIGN REVIEW only
T01-T04                NOT_STARTED   REACHABILITY_REVIEW_REQUIRED
T05-T10                EXECUTION_LOCKED (launcher dependency)
self-lineage regression NOT_IMPLEMENTED — gates any global PASS
```

## P7. ACTIVE LOCKS

```
launcher NOT_AUTHORIZED · SP01 NOT_AUTHORIZED · restart NOT_AUTHORIZED
broadcast LOCKED · capital UNTOUCHED
executor bytes PRESERVE EXACT

governed runtime state   NOT_REOBSERVED_BY_PRESERVATION_TRANSACTION
runtime action           NOT_AUTHORIZED
```

### Provenance note on runtime state

This transaction is documentation-only and performs **no runtime census**. Any
earlier quiescence finding belongs to the run that observed it and is not
restated here as a present-tense fact. A fresh session must observe runtime
state itself before relying on it.

## P8. EVIDENCE PRESERVED

```
R80BB aborted-D01 evidence hold   /home/allmight/r80_a_fixture/D01/   1453 files
  archive c93bc279…  manifest a9e2899b…   IMMUTABLE, not a fixture source
S-slice evidence packages         PRESERVE UNCHANGED
```

## P9. NEXT AUTHORIZED TECHNICAL STEP — SUPERSEDES ANY EARLIER NEXT-STEP SECTION

```
C01-C08 DESIGN REVIEW
  NOT implementation
  NOT execution
```

Nothing else is authorized. A fresh session asks Boss for the current directive.

**STOP.**
