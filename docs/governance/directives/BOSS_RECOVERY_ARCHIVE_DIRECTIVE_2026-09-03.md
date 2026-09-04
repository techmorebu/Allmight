# BOSS DIRECTIVE — RECOVERY / ARCHIVE FIRST

**Issued:** 2026-09-03/04 transition  
**Authority:** Boss  
**Scope:** archival and recovery continuity only

## RULING

The frozen 2026-09-03 recovery checkpoint remains an authoritative historical
checkpoint. Its §7 router recurrence diagnostic is **not the current executable
directive** merely because it was next at freeze time.

Current ordering is:

1. Freeze the durable recovery state.
2. Verify the Wave 11/CPT evidence archive by SHA-256.
3. Establish the repository recovery/governance/index overlay.
4. Preserve large evidence bytes in the AllMight Google Drive archive.
5. Verify that a fresh CPT/chat can reconstruct the project without relying on
   prior chat history.
6. Only then may Boss re-evaluate whether the router recurrence diagnostic
   remains the next runtime slice.

## ACCEPTED RECOVERY FACTS

- Wave 11 artifact verification: 22 indexed artifacts, 22 exact SHA-256 matches,
  0 missing, 0 mismatches — `ARCHIVE VERIFIED`.
- GitHub connector write access is currently blocked by integration permission
  (`403 Resource not accessible by integration`).
- This is an integration limitation, not a governance denial.
- A deterministic local repository overlay/apply procedure is therefore the
  authorized workaround after archive recovery is complete.

## HARD BOUNDARY

This directive authorizes **documentation/archive recovery only**.

It does NOT authorize:
- runtime repair or restart
- router restart
- Incident 022 application
- second heartbeat activation
- Redis access
- stack restart
- live trading
- signing or broadcast
- capital movement
- threshold/economic changes

The existing execution/capital locks remain engaged.

## PRECEDENCE

Running machine > repository > frozen recovery documents > chat memory.

If repository HEAD or runtime state differs from the frozen checkpoint, report
the disagreement. Do not silently reconcile it.
