# ALLMIGHT — RECOVERY CHECKPOINT

**Refreshed:** 2026-09-06 (M2E-016E) · **Authority:** Boss · **Standard:** GOV-CHK-001

```
base (parent) commit   371dcc4f66bf8ba6b7049f66721bff58335a1924
this checkpoint         travels in the commit that supersedes that base and
                        records the SHADOW CAUSAL COVERAGE OUTPUT AUTHORITY —
                        implemented, dispatched, DECLARED, and NOT ACTIVATED.
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
SHADOW-SILENT-FAILURE  OPEN. The launcher runs both engines under
              `2>/dev/null || true`, so stderr is DISCARDED and a non-zero exit
              is SWALLOWED. Both engines can fail every cycle, forever, with no
              trace. The wrapper also SLEEPS FIRST, so for the first 300s of a
              session `kill -0` reports a healthy component that has never run.
              This BLOCKS any shadow authority activation: output proves work
              LANDED; it says nothing about a cycle that died before writing.
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
```

## 11. THE EXACT NEXT AUTHORIZED ACTION

**Return to Boss for review.** This checkpoint is the deliverable; no further
work is authorized by it.

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
