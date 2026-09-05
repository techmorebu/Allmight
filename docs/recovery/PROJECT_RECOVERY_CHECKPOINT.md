# ALLMIGHT — RECOVERY CHECKPOINT

**Refreshed:** 2026-09-05 (R8B) · **Authority:** Boss · **Standard:** GOV-CHK-001

```
base (parent) commit   db4ebc28e23bb93ee6281ef87cf702b7bfb673dd
this checkpoint         travels in the commit that supersedes that base and
                        corrects a now-FALSE statement: the M2E-001 volatility
                        producer is DEPLOYED AND EXECUTING, not merely committed
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
               volatility        AUTO_ON_NEXT_CYCLE   PROVEN (M2E-001-R7: a
                                 heartbeat from post-patch bytes appeared with
                                 no restart, signal or deploy command)
               fetcher           UNKNOWN — its launch shape RESEMBLES
                                 volatility's, but resemblance is not evidence
                                 and no auto-reload has been observed
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
INCIDENT 023  FOUR components record WRAPPER pids, not two — fetcher,
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
12 A test must be PORTABLE. console.log passes through a formatter that can
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
heartbeat payload schema      heartbeatSchemaVersion 1
Drive pre-prune snapshot      f29f8aa19d9d1ff5a1bda77715a6daa0880c31953a4e548505d5cee1620cb1c5
```

## 11. THE EXACT NEXT AUTHORIZED ACTION

**Return to Boss for review.** This checkpoint is the deliverable; no further
work is authorized by it.

The volatility producer is committed, deployed and emitting; only the AUTHORITY
remains. An activation contract (session-bound = true, PID-bound = false, stale
window 180s PROPOSED and NOT ratified) has been discussed but **NOT released** —
it would be an evaluator and contract change, and `health.js` has not been
touched since M2-D.

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
