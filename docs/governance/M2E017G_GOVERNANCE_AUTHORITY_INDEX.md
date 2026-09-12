# M2E-017G GOVERNANCE AUTHORITY INDEX

Generated 2026-09-10T04:34:57Z. Prevents future loss of the recovered certification standards.

All bytes preserved in `ORIGINALS/` in this package. **None are in the canonical
repository** — git canonicalization remains a separate preservation decision.

**AUTHORITY STATUS (R80D):** the exact recovered bytes of **R28, R29, R30, R33 and
R40 are ACCEPTED as R80 governance authority.** R28 is the primary 42-case matrix;
R29 constrains fixture honesty; R30 governs the stop-propagation correction; R33
provides later authorization context; R40 governs command-position and verifier
consistency. They are no longer merely `RECOVERED_GOVERNANCE_AUTHORITY_CANDIDATE`.

| File | SHA256 | Bytes | Role |
|---|---|---|---|
| `BOSS_M2E_017G_R28_DESIGN_ACCEPT_BUILD_AUTHORIZED.txt` | `c465ee2eece143c8c6439ba9b891e77829bbcf0785e7dc5de0b10f43b76f3505` | 7462 | **PRIMARY A/I/D/S/C/T matrix definition**, lines 91-138 |
| `BOSS_M2E_017G_R29_BUILD_STATUS_CONTINUE_MATRIX.txt` | `0619e41379bc3fe648b29b816338d706b764319b03445989d42783dc8b15beb2` | 5658 | fixture-honesty / signal-adapter constraints; A04 accepted |
| `BOSS_M2E_017G_R30_SUBSHELL_STOP_PROPAGATION_DEFECT.txt` | `efa2806bc185d5f1753da6842bd0a283d0544c9bfa910c7f62c275a3a8fa5ecc` | 6860 | stop-propagation defect correction |
| `BOSS_M2E_017G_R33_SP01_SP05_AUTHORIZED.txt` | `155990048ba2b5114b1fcbba584a7aa43f972d59b896efa89ea171ff7d7c4fb7` | 6078 | SP01-SP05 authorization context |
| `BOSS_M2E_017G_R40_A04_PASS_VERIFIER_INVARIANT_SP_AUTHORIZED.txt` | `f12e5ab2b696d7848b0637d28f1b489ed0943f2ee0ba6d6d69de4a896ada92d3` | 6709 | **command-position + verifier-consistency authority** |
| `BOSS_M2E_017G_R79G_HOST_EXECUTION_AUTHORIZATION.txt` | `435ede001033a656e051d679ddf34edc1c3de063d9427ec5ae89786930ceb936` | — | R79 host-run authorization and pass standard |
| `BOSS_M2E_017G_R80_FULL_EXECUTOR_RECERTIFICATION_AUDIT_DIRECTIVE.txt` | `383c30a126c6a7341af494b9ba1b15c68518513cfad8cfa5f40691f0d6e4e817` | — | R80 full re-certification directive |
| `BOSS_M2E_017G_R80A_AUTHORITY_RECOVERY_RULING.txt` | `e32c47dd8726a084f110bedf388bd9462514d9e4a1ee8b522387af340ebfee29` | — | authority recovery after matrix STOP |
| `BOSS_M2E_017G_R80B_BUILD_DOCUMENTATION_AND_AUTHORITY_PRESERVATION.txt` | `c4ef871ecbc57e1274f18c5d227f429210dd997aa4781e7ee4fe7254aad95a4c` | — | documentation lane standard |
| `BOSS_M2E_017G_R80C_BUG_AND_INCIDENT_TRACKING_STANDARD.txt` | `97456c338d1d37b7280464fffb774ea6d26698b2e6c36edd25b64449e68a9b0e` | — | bug/incident tracking standard |
| `BOSS_M2E_017G_R80D_DOCUMENTATION_T10_CORRECTION.txt` | see MANIFEST | — | T10 scope correction; accepts R28/29/30/33/40 as authority |
| `BOSS_M2E_017G_R80E_...WORDING_CORRECTION.txt` | `7a825cf58355c8c923b7a839b307cdf7affa6fa30c877deef0ebde080b6fd4c5` | — | BUG-010 regression-wording precision |
| `BOSS_M2E_017G_R80F_MANIFEST_INTEGRITY_CORRECTION.txt` | `7ae471422fcf5ed68ba548c3ed2c1b305d273255400fd941a8fc98534c8d573e` | — | BUG-011; manifest regeneration from final bytes |
| `BOSS_M2E_017G_R80G_STAGE1_ACCEPTANCE_PRESERVATION_PREP.txt` | `ee0206ce70e5bc47ddc75f4315416025ab3bc68a124a687ede8321532ac27f2e` | — | Stage-1 accepted; BUG-011 FIX_VALIDATED; preservation prep |
| `BOSS_M2E_017G_R80H_READ_ONLY_CANONICAL_REPO_INSPECTION.txt` | `a08c3f1bd9ee1444d9d9dc4fdf0553ae08f7a365bb2ef306eff7d1efd78f4c9f` | — | read-only canonical repo inspection |
| `BOSS_M2E_017G_R80I_TARGETED_DOC_CONFLICT_INCIDENT_READ.txt` | `896dcc08780391b00fef77b275702feeb5e917d38e03a2322e3336198af318bd` | — | committed-byte read of checkpoint + incident index |
| `BOSS_M2E_017G_R80J_SEGMENTED_CHECKPOINT_READ.txt` | `916a7583d13886da0f4f956fb133bce7c6a41bb0daca66f6e8f71def07403df6` | — | segmented checkpoint recovery + completeness check |
| `BOSS_M2E_017G_R80K_PRESERVATION_GOVERNANCE_RULING.txt` | `5687d10912cc527fe9f13e75407c125d64bd9edc196fd617b1719a94972493ca` | — | GOV-CHK-001 controls commit; "no sixth path" scoped; §§3/6/12 supersession; incident dispositions |
| `BOSS_M2E_017G_R80L_PRECOMMIT_REVIEW_CORRECTION.txt` | `f367a0c7619f920bce2c151411e45676094fb94d2accfbd67d3dbe756ffc07d2` | — | **pre-commit review correction**: BUG-011 staged-state repair to FIX_VALIDATED; BUG-009 recurrence capture; byte-prefix proof required |
| `BOSS_M2E_017G_R80M_HOST_MERGE_CONSTRUCTION_AUTHORIZATION.txt` | `a779a190999837fb6ddff9eb1319991839edb3a3efaf939500905997306455eb` | — | **host merge construction**: temporary non-canonical concatenation; prefix AND suffix proof; canonical repo unchanged |
| `BOSS_M2E_017G_R80N_FINAL_PRESTAGE_DOCUMENTATION_REFRESH.txt` | `e53116db3ed4e7fba6e78b97c6ee38c3b04e4c61462f3e8a62d1cc6a2e6130a8` | — | **final freshness gate**: authority chain must not be stale at commit; merge-SHA invalidation rule |

## RELATIONSHIPS
- **R28 feeds** the behaviour matrix document and the R80 plan.
- **R29 constrains** how S-group fixtures may be built (no stubbing `signal_one()`;
  production path retains the single real `kill -TERM`; adapter impossible without
  explicit test mode; test mode self-evident in evidence; packaging proves the
  production default is real-syscall mode).
- **R40 constrains** command-position counting and verifier consistency for the
  entire executor, including new seam gates (R80 Ruling 2).
- **R80 supersedes** any scoped/delta audit proposal; full matrix required.
- **R80B/R80C feed** this index, the bug ledger and the recovery checkpoint.
- **R80K constrains** the eventual commit: GOV-CHK-001 governs it, the §11
  "no sixth path" lock is scoped to the M2E-017C five-path source-repair commit,
  and stale operational sections must be marked SUPERSEDED rather than deleted.
- **R80L corrects** the pre-commit review; **R80M authorizes** host merge
  construction only; **R80N gates** preservation freshness and forbids carrying a
  stale merged SHA across an overlay mutation. R80N supersedes nothing; it adds a
  freshness precondition to R80K's preservation path.

## PRESERVATION DESTINATION
All originals above are proposed for `docs/governance/authority/m2e017g/`, one
immutable file per ruling. No existing authority file is overwritten; the
directory does not exist in canonical HEAD.

## CORRECTION OF RECORD
CPT's first R80 inventory named R29/R30/R33 as the matrix definition source.
That was **wrong**. R29/R30/R33 reference the groups; **R28 defines them.**
The initial search missed R28 because it searched for the literal phrase
`A/I/D/S/C/T` rather than for the case identifiers `A01..T10`.

**Second correction (R80D):** the first transcription of R28 dropped **T10**,
making the T group 9 cases instead of 10. R28 defines **T01-T10**; the derived
count is A4 + I6 + D6 + S8 + C8 + T10 = **42**. Recorded as BUG-010 (S2).


---

## PRESERVATION OVERLAY 2 — 2026-09-12T00:53:58Z
**Authority:** Boss R80CB / R80CC · **Transaction:** `M2E017G-PRESV-002`
**Baseline HEAD:** `4133fd9dd5b84565c3903e85ef04c6d6325aa2f4`

Content above is preserved verbatim; where superseded, this section controls.

### Authority preserved by this transaction

52 further originals added under `docs/governance/authority/m2e017g/`,
covering **R80O–R80CC** (excluding the chat-only block below). Combined with the
21 preserved at `4133fd9d…`, canonical authority now spans R28 → R80CC except
as noted.

### PROVENANCE GAP — chat-only rulings

Fifteen rulings arrived as relayed chat text with **no artifact file**. Their
substantive rulings are recorded in the ledgers and checkpoint. Their provenance
is **not** upgraded, and no synthetic file has been created to stand in for them.

```
RULING_ID                 R80BK R80BL R80BM R80BN R80BO R80BP R80BQ R80BR
                          R80BS R80BT R80BU R80BV R80BW R80BX R80BY
PRESERVATION_STATUS       SUMMARY_PRESERVED
SOURCE_FORM               RELAYED_CHAT_TEXT
ORIGINAL_ARTIFACT_SHA256  UNAVAILABLE
```

For every other ruling in this transaction:
`PRESERVATION_STATUS=ORIGINAL_PRESERVED`, `SOURCE_FORM=BOSS_ARTIFACT_FILE`,
`ORIGINAL_ARTIFACT_SHA256` as listed in the transaction manifest.
