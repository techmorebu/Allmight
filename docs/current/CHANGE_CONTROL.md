# CHANGE_CONTROL

**Status:** OPERATIONAL LAW — every change to AllMight must be classified before merge.  
**Authority:** Boss-only for the taxonomy itself. CPT classifies changes against the taxonomy and escalates ambiguous cases.  
**Purpose:** Prevent silent operational drift. Establish reproducibility. Make rollback decisions deterministic.

---

## Core principle

Every change has a tier. Every tier has known approval requirements, validation costs, and rollback implications. **No change is exempt from classification, no matter how small.**

If a change cannot be classified, that itself is the classification result: **escalate to Boss.**

---

## Change tier taxonomy

| Tier | Name | Examples | Approval | Validation impact | Rollback risk |
|------|------|----------|----------|-------------------|---------------|
| **T0** | Documentation only | adding docs, fixing typos, clarifying comments | CPT can self-authorize | none | trivial |
| **T1** | Observability only | adding log fields, audit script improvements, telemetry expansion | CPT can self-authorize | none — but must not change runtime behavior | trivial |
| **T2** | Non-runtime logic | offline analysis tools, reports, calibration scripts that read existing data | CPT can self-authorize for new tools; Boss ruling for changes affecting Boss-validated reports | none for new; may require re-run for changes | low |
| **T3** | Runtime affecting | activator parameters, RPC routing, supervisor cadence, scanner intervals | **Boss ruling required** | re-audit on a fresh session; existing C9 sessions still valid as historical baseline | medium — possible behavior shift |
| **T4** | Execution affecting | gate thresholds, simulation logic, order routing, executor contract changes | **Boss ruling required + new dry-run evidence** | invalidates prior rehearsal evidence; new 5/5 cycle required | high — direct impact on trade decisions |
| **T5** | Live-capital affecting | enabling LIVE_DEPLOY_APPROVED, raising trade size, changing first-trade floor, multi-surface activation, profit recipient change | **Boss ruling + multi-stage gate progression + cold sign-off** | invalidates all prior validation; requires fresh statistical evidence | extreme — capital at risk |

---

## Tier-by-tier rules

### T0 — Documentation only

```
EXAMPLES                  README updates, doc fixes, comment additions,
                          new docs in docs/current/
PROCESS                   - CPT drafts
                          - operator reads
                          - direct commit acceptable
INVALIDATES               nothing
REQUIRES ROLLBACK IF      doc claims become wrong (then update or revert)
ALLOWED IN HOTFIX MODE    yes
```

### T1 — Observability only

```
EXAMPLES                  new log fields in JSONL emissions
                          new audit script sections
                          additional metrics in heartbeat
                          new Discord notification types (channel-existing)
PROCESS                   - CPT implements with explicit "T1" justification
                          - patch must NOT change runtime behavior
                          - re-run any audit affected
INVALIDATES               nothing — observability is additive
REQUIRES ROLLBACK IF      observability change introduces runtime side effect
                          (then escalate to T3+)
ALLOWED IN HOTFIX MODE    yes
```

### T2 — Non-runtime logic

```
EXAMPLES                  new offline calibration scripts
                          new portfolio reports
                          new analysis scripts in scripts/tools/
                          changes to metrics computation that don't feed
                            back into runtime gates
PROCESS                   - CPT implements
                          - if change affects Boss-validated reports
                            (e.g., regime classifier output, confidence scores),
                            escalate to T3
INVALIDATES               none for net-new tools
                          changed reports require re-validation against
                            golden sessions before being used for decisions
REQUIRES ROLLBACK IF      tool produces incorrect outputs that have
                          influenced operator decisions
ALLOWED IN HOTFIX MODE    yes for new tools; no for changes to existing tools
```

### T3 — Runtime affecting

```
EXAMPLES                  activator threshold changes (NOT execution gates)
                          RPC provider priority changes
                          supervisor restart cadence
                          scanner polling intervals
                          watchdog thresholds
                          tick-map refresh logic (B2 patch was T3)
PROCESS                   - CPT proposes with Boss ruling request
                          - Boss authorizes
                          - CPT implements
                          - re-audit on fresh session via system_integrity_audit.sh
                          - confirm pre-existing C9 sessions still valid
INVALIDATES               nothing on its own
                          but: comparison against pre-change baseline becomes
                          regime-dependent; document the change in INCIDENT_LOG.md
                          if it was bug-driven
REQUIRES ROLLBACK IF      audit fails; STATE_UNHEALTHY pattern emerges that
                          wasn't there before
ALLOWED IN HOTFIX MODE    only for fail-closed restoration (e.g., reverting
                          to known-good); never for new behavior
```

### T4 — Execution affecting

```
EXAMPLES                  gate threshold changes (spread, gas, depth, slippage)
                          simulation logic changes (callStatic verify, fee math)
                          order routing changes (Aave flash → swap path)
                          executor contract changes (new deploy = T4 minimum,
                            T5 if crossing surfaces)
                          rehearsal floor changes
PROCESS                   - CPT proposes with Boss ruling request including
                            quantitative justification (data, examples)
                          - Boss authorizes
                          - CPT implements behind a feature flag where possible
                          - new dry-run evidence required (full 5/5 cycle)
                          - 1+ rehearsal pass on the post-change behavior
                          - update SYSTEM_STATE.md to reflect new policy
INVALIDATES               all prior rehearsal evidence
                          all prior C9 sessions (must re-establish on new code)
                          existing live-trade authorizations (Boss G3 must
                            be re-issued post-change)
REQUIRES ROLLBACK IF      rehearsal regresses; new failure mode emerges
ALLOWED IN HOTFIX MODE    no — except for fail-closed restoration
```

### T5 — Live-capital affecting

```
EXAMPLES                  enabling LIVE_DEPLOY_APPROVED for a trade
                          raising trade size beyond first-trade $25 cap
                          lowering the 26 bps first-trade floor
                          lowering the 24 bps live hard rule
                          activating a second surface for live execution
                          changing the executor's profit recipient
                          adding new chains to live execution
PROCESS                   - CPT package: full statistical evidence + risk
                            analysis + rollback procedure
                          - Boss ruling required, ON RECORD, time-stamped
                          - Cold sign-off where applicable (e.g., recipient
                            change requires owner-key signature)
                          - Implementation under explicit feature flag
                          - First execution under direct operator
                            observation, NOT background
                          - Post-execution forensic review mandatory
INVALIDATES               all prior live-trade authorizations
                          all prior validation if architecture changed
REQUIRES ROLLBACK IF      single live trade reverts unexpectedly
                          unexpected gas, slippage, or counterparty behavior
                          any deviation from forensic expectation
ALLOWED IN HOTFIX MODE    no, with one exception: emergency disarming
                          (setting LIVE_DEPLOY_APPROVED=false) is always
                          authorized and never requires Boss ruling
```

---

## What to do when classification is ambiguous

```
1. Default to higher tier — when in doubt, treat as T3+ minimum.
2. Document the ambiguity in the Boss ruling request.
3. Boss may rule the change is actually lower tier; that ruling
   itself becomes the classification record.
4. Never implement first and classify later.
```

---

## Cross-cutting rules

### Live-disarm is always permitted

Setting `LIVE_DEPLOY_APPROVED=false` requires no ruling. It is the universal safe state. Any operator (including CPT acting on operator behalf) may disarm at any time, in any mode, without permission.

### Patches must reference their tier

Every commit message touching `scripts/`, `contracts/`, or `.env`-affecting files should include the change tier:

```
git commit -m "T3: activator hard-cap age override (Boss B2 ruling 2026-05-07)

Adds MAX_TICK_MAP_AGE_MS hard cap to refresh gate to prevent
quiet-market deadlock. Ruling: Boss 2026-05-07 (B2)."
```

### Rollback procedure (any tier)

```
1. git tag the current state with -rollback-from suffix
2. git revert the offending commit (or git checkout known-good)
3. restart stack via scripts/tools/start_all.sh
4. re-run system_integrity_audit.sh
5. document the rollback in INCIDENT_LOG.md
6. notify Boss of the rollback action
```

### Validation invalidation matrix

| Change tier | C9 sessions | Rehearsal evidence | Live G3 ruling |
|-------------|-------------|-------------------|----------------|
| T0 | preserved | preserved | preserved |
| T1 | preserved | preserved | preserved |
| T2 | preserved (new tools); affected outputs need re-run | preserved | preserved |
| T3 | preserved as historical; new sessions on new code | preserved if behavior contract unchanged | preserved if no execution effect |
| T4 | preserved as historical; cannot be cited as current proof | **invalidated** — fresh 5/5 required | **invalidated** — Boss must re-rule |
| T5 | preserved as historical | **invalidated** | **invalidated** |

---

## Process for proposing a Boss-ruling-required change

```
1. CPT drafts a "Boss ruling request" with:
   - Change tier classification
   - Specific files and lines affected
   - Quantitative justification (data, examples)
   - Risk analysis (what could go wrong)
   - Validation plan (how to prove it works)
   - Rollback procedure
   
2. Operator pastes the request to Boss.

3. Boss responds with:
   - APPROVED — proceed with the listed validation
   - APPROVED WITH CHANGES — apply Boss edits, then proceed
   - DEFERRED — collect more data first
   - REJECTED — do not implement; document the rejection

4. CPT implements per the ruling.

5. Validation runs per the ruling's plan.

6. Update SYSTEM_STATE.md to reflect the new authoritative state.

7. Commit references the Boss ruling explicitly.

8. If validation fails: rollback per the procedure above.
```

---

## Hotfix mode

In a true emergency (live trade about to revert in an unsafe way, on-chain exploit being attempted, etc.), the operator may:

```
1. Disarm immediately (LIVE_DEPLOY_APPROVED=false). No ruling required.
2. Stop the stack (bash scripts/tools/start_all.sh --stop).
3. Document the action in INCIDENT_LOG.md.
4. Notify Boss with full context.
5. Wait for Boss ruling before re-arming.
```

There is no other hotfix authority. **The system fails CLOSED, and emergency response disarms — never modifies behavior under pressure.**

---

## What this protects against

```
Silent threshold loosening ("market is quiet, let's drop to 18 bps")
                            → blocked by T4/T5 classification

Multiple simultaneous changes ("let's also fix this while we're here")
                            → each change classified independently;
                              prevents bundled drift

"Just a small refactor" ("clean up the activator while we're patching")
                            → triggers T3 classification, requires re-audit

AI-driven incremental drift ("each change was small, but cumulatively...")
                            → classification + commit referencing prevents
                              this; INCIDENT_LOG.md catches the cumulative

Skipping validation ("we tested locally, ship it")
                            → T3+ requires audit pass; T4+ requires fresh
                              rehearsal; no escape hatches
```

---

## Recurring rituals (operational hygiene)

```
Before any Boss ruling request    classify the change yourself first;
                                    state the tier explicitly in the request

Before any commit                  state the tier in the commit message

Before any rollback                document why; tag the broken state

Weekly                             review docs/current/SYSTEM_STATE.md
                                    against actual runtime; update if drift
                                    has occurred (which itself is a T0 patch)

Monthly                            review INCIDENT_LOG.md for patterns;
                                    if the same tier of issue recurs,
                                    escalate to Boss for prevention ruling
```

---

## References

- `ARCHITECTURE_LOCK.md` — what the system IS and IS NOT
- `CANONICAL_SURFACE.md` — surface authority
- `SYSTEM_STATE.md` — runtime authority
- `INCIDENT_LOG.md` — historical record of bugs, drifts, rollbacks
- `OPERATOR_RUNBOOK.md` — operational procedures including emergency disarm

---

## Final clause

The taxonomy in this document is what stands between AllMight and slow architectural decay. Every assistant who reads this file is bound by it. Every patch is classified. Every classification is documented. Every documented classification is auditable.

**There are no exceptions for "this is just a small change."** Small changes that bypass classification are exactly how mature systems silently drift into broken states.

When in doubt, the answer is the same as in `ARCHITECTURE_LOCK.md`:

**Do nothing. Escalate to Boss.**
