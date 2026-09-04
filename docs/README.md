# AllMight — governance & recovery

```
recovery/    PROJECT_RECOVERY_CHECKPOINT.md   ← START HERE
             ARCHITECTURE_STATE.md · GOVERNANCE_STATE.md · ROADMAP_STATE.md
governance/  directives/ · rulings/ · phase-closeouts/
evidence/    EVIDENCE_INDEX.md · INCIDENT_INDEX.md · ARTIFACT_INDEX.md
             verify_index.sh
archive/cpt/ retired CPT project-knowledge originals
```

**Storage authority**
```
GitHub  canonical versioned governance history — indexes and hashes
Drive   the bytes: ZIP bundles, raw logs, exports
CPT     a small disposable working set, reconstructable from the above
```

**PRECEDENCE: if a document and the repository disagree, the repository wins,
and if the repository and the running machine disagree, the machine wins.**
A recovery document that outranks reality would become the next false-assurance
artifact — the exact class this architecture exists to remove.

**Before pruning anything:** `bash docs/evidence/verify_index.sh <artifact-dir>`
must print `ARCHIVE VERIFIED`.
