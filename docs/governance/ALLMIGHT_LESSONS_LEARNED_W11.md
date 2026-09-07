# ALLMIGHT — LESSONS LEARNED

**Source:** Wave 11, S9 → M2E-017B (supervision redesign and M2-E migration)
**Purpose:** prevent recurrence. Every rule below cost at least one slice.

> These are ordered by how often they bit, not by importance. The first
> section is the single largest source of wasted effort in the entire arc.

---

## PART 1 — THE MEASUREMENT PROBLEM

**Roughly twenty times in this arc, a measurement CPT wrote was wrong while the
system was fine.** The system's own instruments were right every time. That
ratio is the most important fact in this document.

### L1 — A ZERO RESULT IS NOT EVIDENCE UNTIL THE PROBE CAN FIRE

Before accepting "nothing found", prove the search can find a known positive.

```
FAILED   grep for kill -INT across scripts → 0 hits → "no SIGINT sender"
FIXED    write a file containing `kill -INT 123`, prove the pattern matches 2/2,
         THEN accept the zero
```

Instances: the credential scanner, the reference checker, the SIGINT search,
the fatal-path emit check, the delimiter search. **Every one of them now ships
with a control.**

### L2 — `pgrep -c` PRINTS 0 AND EXITS NON-ZERO

```
BROKEN   STRAY=$(pgrep -fc 'x' || echo 0)     → STRAY becomes "0\n0"
         [ "0\n0" -eq 0 ] fails → a clean stop reported as a failure
FIXED    STRAY=$(pgrep -fc 'x'); STRAY=${STRAY:-0}
```

The `|| echo 0` idiom fabricates counts. It appeared at least twice.

### L3 — UTC TIMESTAMPS INTO LOCAL-TIME QUERIES

`journalctl --since` and `date -d` interpret bare strings as **local time**.
Passing a UTC value searched a window five hours off target and produced
confident, wrong conclusions about SSH sessions.

```
RULE   every local-time query must PRINT its conversion inline:
         source event  22:50:34 UTC
         zone          America/Chicago
         converted     17:50:34 CDT
         window        17:45-17:55 CDT
```

Never hard-code `CST`; use `America/Chicago` so DST is handled.

### L4 — A PATTERN THAT CANNOT SEE STRUCTURE IS A GUESS

```
grep 'secret'                    matched allmight/security/secrets.py
find -name runtime_adapter.js    matched test/refs/, not staging/
awk '/\.catch\(\(err\)/,/…/'     matched the FIRST catch, not the intended one
grep for stale test labels       three successive greps each missed at least one
```

**Match on path components, full relative paths, or unique anchors** — never on
a substring that happens to appear.

The stale-label sweep was only solved by an AST-shaped comparison of every test
label against its own body. That found four; three greps had found one.

### L5 — CONSOLE OUTPUT IS NOT MACHINE-READABLE

`console.log(process.pid)` passes through a formatter that can inject ANSI
escapes. `Number(stdout.trim())` then yields `NaN` and **fails a correct
implementation**.

```
PREFER   process.stdout.write(JSON.stringify({...}))
BETTER   verify from the ARTIFACT, not from stdout at all
```

### L6 — MTIME IS THE LAST WRITE, NOT THE FIRST

A startup-latency probe used directory mtime and produced values spanning
2790–28637 seconds. Meaningless. **The first timestamped record is the first
write; mtime can never be.**

Related: a `.jsonl` file appended across many cycles has one mtime for all of
them.

### L7 — A HARNESS MUST RUN AGAINST WHAT IT WAS BUILT FOR

Two consecutive slices failed on this.

```
1  a one-cycle fixture built from CPT's reference tree, whose indentation
   differed from the deployed file → sed didn't match → the test slept 300s
   and looked like a behavioural failure
2  a bundle suite rewritten with sed to point at a live repo file → the
   extraction range differed → one of two subjects never ran
```

```
RULE   build fixtures from DEPLOYED BYTES, verified by sha
RULE   a harness must SELF-PROVE its fixture before running any test:
         no executable sleep, all subjects present, single iteration
RULE   do not rewrite a suite's paths to point at something it wasn't built
       for — run it as shipped, and verify the live artifact by hash separately
```

### L8 — SMALL SAMPLES AND CENSORED FIRST OBSERVATIONS

```
n=1 is not a distribution      (a 139ms rewrite window, later measured max 92ms)
p95 == max at n=12             two derivations of one number, not corroboration
the FIRST interval is censored when sampling starts mid-cycle — exclude it
duplicate detection            a completed item must enter a PERMANENT seen set,
                               or it re-registers and inflates n
```

One measurement reported six samples that were three blocks counted twice.

---

## PART 2 — EVIDENCE AND CLAIMS

### L9 — RESEMBLANCE IS NOT EVIDENCE

`DEPLOY_SEM` was proven `AUTO_ON_NEXT_CYCLE` for volatility by observing new
bytes execute without a restart. It was then **assumed** for fetcher,
shadow_engine and activator because their launch shapes looked similar.

```
RULE   upgrading an UNKNOWN requires observed evidence for THAT component.
       UNKNOWN fails closed.
```

Fetcher was later upgraded correctly — by observation, in 30 seconds.

### L10 — ABSENCE OF EVIDENCE IS NOT EVIDENCE OF A DIFFERENT MECHANISM

When a heartbeat did not appear, the correct verdict was `UNKNOWN`, not
`RESTART_REQUIRED`. The producer deliberately emits nothing on several paths,
so absence was consistent with correct behaviour.

### L11 — SIGNAL CLASS IS NOT SENDER IDENTITY

An exit record naming `SIGINT` says what arrived, never who sent it. Linux
retains no sender without `auditd` configured in advance.

```
ALLOWED      "the router terminated via SIGINT"
NOT ALLOWED  "the watchdog sent SIGINT"   (without discriminating evidence)
```

### L12 — AN OUTPUT IDENTIFIER IS NOT AN INPUT KEY

`signalId` looked like the causal work key. It is **constructed by the consumer**
from `<session>-<block>`; zero upstream records carry it. Building an evaluator
around it would have compared shadow's output against itself.

The real key was `block`, and it was ratified only after proving presence
(2515/2515), strict monotonicity, zero collisions and zero unexplained extras.

### L13 — A NAMESPACE IS NOT OWNED BY ITS NAME

`fetcher:*` Redis keys can be refreshed by **volatility**, which calls
`runFetcher()` on its own cycle. Key freshness therefore cannot prove fetcher
liveness.

### L14 — AGREEMENT BETWEEN TWO COMPONENTS PROVES NOTHING IF BOTH SKIP THE SAME INPUT

`activator.jsonl` is 96% unparsable — ANSI console output mixed with JSON. Shadow
skips those lines; so would any evaluator built the same way. The correspondence
proof only held because a separate check confirmed **no required work hides in
the skipped lines**.

---

## PART 3 — SUPERVISION ARCHITECTURE

### L15 — THE RECURRING DEFECT

> A component looks healthy at the layer people check while useful work has
> stopped.

Five instances in one session. `process exists` was used as a proxy for
`component is working`, and the two diverge **silently**.

### L16 — THREE INDEPENDENT AUTHORITIES

```
process    is the pid alive?      crash, kill, OOM
heartbeat  is the loop turning?   hang, deadlock, crash-loop
output     is work landing?       silent no-op, misrouted path
```

Each returns a verdict object carrying its own evidence, never a bare boolean —
an unexplained `false` is indistinguishable from an unevaluated one.

### L17 — RESERVE THE WORD HEALTHY

```
controlState   PASSING | DEGRADED | FAILED | UNKNOWN      never HEALTHY
healthState    HEALTHY | PARTIAL | UNVERIFIABLE | DEGRADED | FAILED | UNKNOWN
```

`reduce()` cannot emit HEALTHY — its vocabulary lacks the word. One field must
be safe to read alone: a consumer should never need a second field to discover
that HEALTHY did not mean healthy.

### L18 — DECLARED IS NOT ACTIVE

A declared signal is not a **failure authority** until its producer is proven
deployed. `PENDING_MIGRATION` yields `NOT_APPLICABLE`, never `FAIL`.

Without this, attaching the observer would have reported all eight components
FAILED — the redesign manufacturing false evidence about itself.

### L19 — A HEARTBEAT MUST BE PRODUCED BY THE WORKER

A wrapper outlives its worker **by design**, so a wrapper-produced heartbeat
proves only wrapper liveness.

For a one-shot worker the worker emits a **cycle-completion** record before
exiting. The guarantee is not that `workerPid`/`producerBuild`/`sessionId` are
unforgeable — a wrapper could write anything. It is that **the only authorized
emitter call site is inside the worker-owned path.**

### L20 — NO OBSERVATION YET ≠ STALE ≠ FAILED

An empty record set has **no timestamp to age**. No threshold can rescue it.
Age the SESSION instead:

```
records 0, sessionAge <= emptyGraceSec   ->  UNKNOWN "not yet observed"
records 0, sessionAge >  emptyGraceSec   ->  FAIL
records > 0                              ->  staleSec / failedSec as normal
```

Treating an empty set as FAIL reported a working activator as broken in a quiet
market.

### L21 — A COMPLETED PROMISE IS NOT A COMPLETED CYCLE

`runFetchersOnce()` resolves `{}` when a Redis lock is held. A naive emit would
claim a completed cycle with **zero fetches** — and since the lock is `SET NX PX`,
one hung holder would produce a healthy-looking cadence forever.

The guard fired in production within minutes of deployment.

```
RULE   emit only on evidence of actual work; report a skip explicitly.
       Silence is indistinguishable from a crash.
```

### L22 — AGE THE WORK, NOT THE OUTPUT

Every conventional output authority asks *"how old is the newest record?"* That
is wrong for any component that legitimately produces nothing when upstream is
quiet.

```
CAUSAL FORM   "is there required work that not every producer has processed,
               and has it been outstanding past the deadline?"
              the clock runs from requiredWork.ts, NEVER from output age
```

### L23 — SEQUENTIAL PRODUCERS RACE, NORMALLY

Two engines reading the same input sequentially will legitimately differ for a
few seconds. Measured: **35 of 35 samples showed a 2.17–5.80s window.**

```
ASYMMETRIC (one covers, one doesn't, within deadline) is a DISTINCT NON-FAILING
state. Immediate failure there would false-red on nearly every work item.
```

### L24 — ZERO BYTES IS NOT ZERO WORK

`fs.writeFileSync` **truncates to zero before writing**. A read in that window
sees an empty file that parses cleanly as "zero covered records" — a confident,
wrong answer with **no parse error at all**.

```
EMPTY_FILE_TRANSIENT_CANDIDATE — zero bytes must pass a bounded re-read before
it can mean anything.
```

### L25 — BYTE LENGTH IS NOT A FINGERPRINT

A ledger rewrite was observed changing content while holding **exactly
2,604,110 bytes**, twice in one hour. A length-only stability check would have
called an actively-rewriting file stable.

```
FINGERPRINT = existence + size + mtime_ns + sha256(bytes)
```

### L26 — BOUND THE RETRY

Exactly one re-read. Unbounded retry turns a transient into an indefinite
UNKNOWN, hiding a real failure behind "still settling".

```
bytes CHANGE across reads    -> transient -> UNKNOWN
bytes STABLE and wrong       -> deterministic -> FAIL
```

### L27 — SILENCED FAILURE IS THE WORST CASE

```bash
node engine.js 2>/dev/null || true      # stderr DISCARDED, exit code SWALLOWED
```

Both engines could fail every cycle, forever, with no trace anywhere.

```
FIX    capture rc=$? and emit a machine-readable record
NOT    set -e — that would abort the cycle and turn a recoverable engine
       failure into a dead component
```

A failure record must carry **engine identity, numeric rc, session, and a UTC-Z
timestamp**. A record that cannot be attributed to an epoch is not evidence.

---

## PART 4 — GOVERNANCE AND PROCESS

### L28 — READ THE DEPLOYED FILE BEFORE EVERY PATCH

CPT's reference tree was stale **three times**. Hash-gating caught all three
before damage; a reconstructed anchor caught none of them.

```
RULE   patchers are hash-gated on the DEPLOYED sha, supplied explicitly as an
       argument — never a built-in default
RULE   read the actual lines before editing; never reconstruct an anchor from
       memory or from an earlier display
```

### L29 — GENERATE MANIFESTS, NEVER TRANSCRIBE THEM

A bundle shipped a stale `health.js` hash because it was typed. The fix computes
every SHA at build time **and re-verifies them against the finished archive**.

Verify **by full relative path**, never by basename.

### L30 — AN UNRATIFIED CONSTANT IS A DEFECT

A 5-second future-time tolerance was imported from a context where filesystem
granularity justified it. It did not transfer, and any window is a gap a touched
artifact can pass through.

```
RULE   carry a constant only where its justification carries too
RULE   separate MEASUREMENT BASIS from POLICY SLACK. The basis is arithmetic;
       the slack is a ruling.
```

### L31 — CLASSIFY A TEST FAILURE BEFORE FIXING IT

```
A  real implementation defect
B  intentional declaration/epoch drift
C  unrelated / environment / fixture
```

One change broke nine suites. Two were real defects; five assertions were epoch
drift. **Retrofitting first would have blessed expectations around a still-broken
implementation.**

Classify each item **exactly once**, by *what made it fail*. If a fixture stopped
supplying evidence, it is a support change (B) even when a count moves as a
consequence — counting it in both ledgers inflates the total and hides whether
every item was addressed.

### L32 — VERIFY EVERY PATH IN THE COMMIT, DERIVED

```
BROKEN   a hand-listed verification set → 3 of 4 paths checked
FIXED    PATHS=$(git show --stat --name-only --format="" "$H")
         → N of N verified by construction
```

Compare **git blob vs raw GitHub content, pinned to the commit SHA**. A
bundle-artifact hash is not a repository hash.

### L33 — THE PRECEDENCE CHAIN

```
running machine  >  repository  >  recovery documents  >  chat memory
```

A recovery document that outranks reality becomes the next false-assurance
artifact. **Report a disagreement; never reconcile it silently.**

### L34 — A DOCUMENT MUST NOT CONTRADICT ITSELF

A checkpoint once said "four affected components" in one section and "two" in
another. A document disagreeing with itself teaches readers to trust neither
half. Likewise a header naming a superseded revision.

### L35 — SOURCE REPAIR IS NOT RUNTIME REMEDIATION

```
DEPLOY-SEM classification is MANDATORY before editing a runtime-relevant path:
  AUTO_ON_NEXT_CYCLE   a wrapper relaunches from the repo path — COMMITTING IS
                       DEPLOYING, with no gate between git and running
  RESTART_REQUIRED     a long-lived process must be restarted
  NOT_RUNTIME          nothing loads it
  UNKNOWN              FAILS CLOSED — treat as live and gate it
```

Editing a long-lived shell script beneath a running bash process risks mid-loop
byte-offset corruption. Editing an auto-reloading worker deploys it within
seconds.

### L36 — ONE ACTION PER SLICE

Every stop condition returns evidence and never repairs. A verification bundle
must reproduce from clean extraction; if it needs an unchanged file, include it
and list its SHA.

### L37 — SHELL AND OPERATIONAL HYGIENE

```
never paste a heredoc-defined function containing `exit` into an interactive
  shell — it closes the terminal
define helper functions in the SAME scope that uses them; appending past a
  function definition leaves later calls undefined
give an explicit `cp ~/Downloads/<file> <dest>` — never "place" or "drag"
verify a download landed (sha256sum) BEFORE running; four stops in one session
  were a missing ~/Downloads file, not a defect
list required bundles at the TOP of every install block
```

---

## PART 5 — THE SHORT VERSION

If only ten lines survive:

```
1   prove a probe can fire before trusting its silence
2   read the deployed file before every patch; hash-gate the change
3   resemblance is not evidence; UNKNOWN fails closed
4   absence of evidence is not evidence of a different mechanism
5   age the work, not the output, for anything that can be legitimately idle
6   declared is not active; producer deployed is not authority activated
7   generate manifests and verification sets; never hand-list them
8   classify a test failure before fixing it — A, B, or C
9   separate measurement basis from policy slack
10  the machine outranks the repo; the repo outranks the document
```

**And the meta-lesson:** in this arc the system was almost always fine and the
instrument was almost always wrong. When something looks broken, **suspect the
measurement first.**
