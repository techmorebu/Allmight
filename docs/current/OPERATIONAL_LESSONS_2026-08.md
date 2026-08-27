# Operational Lessons — August 2026 session cycle

Captured during Wave 10B → hygiene cleanup → GitHub reconciliation → Wave 11 c1.

## Lesson 1: syntax-safe ≠ import-safe (Node)

`node --check file.js` is syntax-only. Some Node entry points execute
work at module load (activator, executors). NEVER use
`node -e "require(...)"` as a passive smoke test — that is a runtime
invocation and will trigger side effects.

**Safe pattern:**
```bash
node --check file.js          # syntax only
```

**Unsafe pattern:**
```bash
node -e "require('./file.js')" # actually runs the module
```

## Lesson 2: short-hash width is not portable

`git log --oneline` uses `--abbrev-commit` with a length that depends on
the repo's object count. Sandbox and production may differ (7 vs 8 vs
more chars). ALSO: `git log --oneline` inserts ref decorations like
`(HEAD -> main, origin/main)` between the hash and the subject.

**Never assert on `git log --oneline` output with a fixed-width hash
prefix + expected subject.**

**Safe pattern:**
```bash
git log --format='%H %s' -5           # full SHA + subject, no decoration
git rev-parse HEAD                     # full SHA, always 40 chars
```

## Lesson 3: telemetry filenames alone are not provenance

A file called `price_replay.jsonl` may be produced by a LIVE observer OR
a synthetic replay generator. Path patterns AND parent directory format
AND sibling-file presence AND record shape ALL matter. Use ALL of them
for provenance validation. Fail-closed on any single failure.

## Lesson 4: transactional deploy trap semantics

`bash trap` fires on `set -e` errors, `SIGINT`, and `SIGTERM`. If the trap
handler itself uses `set -e` and hits an error, the whole thing cascades
unpredictably. Use `set +e` INSIDE the trap handler after disarming it
with `trap - ERR INT TERM`.

## Lesson 5: fast-forward is verifiable via three redundant checks

```bash
git merge-base --is-ancestor origin/main HEAD   # ancestry
git rev-list --count origin/main..HEAD          # ahead count == N
git rev-list --count HEAD..origin/main          # behind count == 0
```

All three should agree. If any disagrees, STOP.

## Lesson 6: rollback quarantine is filesystem-scope, not git-scope

Untracked files removed by a cleanup deploy are NOT recoverable via git
alone. Move them to a quarantine dir outside the repo (preserving
relative paths, SHA-verified at src and dst). Rollback then reverses
both the git reset AND the quarantine move.
