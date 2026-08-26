# Deploy Script Pitfalls

**Companion to:** [`dex_contract_discovery_pitfalls.md`](dex_contract_discovery_pitfalls.md)
**First entry:** 2026-06-04 (post-Wave 8 closure)

This document captures hard-won operational lessons from running deploy
scripts against the AllMight repository. Each pitfall has appeared at
least once in actual deploy execution and caused real (though contained)
damage. Future deploy scripts should treat these as mandatory checks.

---

## Pitfall 1: Bash + Markdown Code-Fence Collision in Commit Messages

### Symptom

When `git commit -m "..."` is called with a multi-line string containing
markdown code fences (triple-backticks), bash interprets the backticks as
command-substitution delimiters and tries to execute the lines between
them. The commit body lands corrupted, and bash emits error spam like:

    /path/to/deploy.sh: line 236: EXECUTION_READY: command not found
    /path/to/deploy.sh: line 237: BEHAVIORALLY_DEAD: command not found

The commit ITSELF succeeds (git received whatever bash produced), but
the message body has substitution artifacts and the script run is noisy.

### Cause

Bash's command-substitution syntax uses single backticks:

    foo=`some_command`

A pair of single backticks delimits a sub-shell. When bash encounters
**three** backticks (`` ``` ``), it parses them as:

  - opening backtick (substitution start)
  - middle two backticks: empty sub-shell + opening of next sub-shell

depending on the surrounding context. In a double-quoted argument
string (the second arg to `-m`), bash is still doing substitution
expansion. Markdown code-fence blocks therefore get bash-evaluated.

### Repro (DO NOT actually run)

    git commit -m "subject

    body explanation here.

    Example block:
      \`\`\`
      KEY_NAME    VALUE
      \`\`\`

    more text"

Even though the writer intended the triple-backticks as markdown
formatting in the commit message, bash sees them as substitution
markers and tries to execute "KEY_NAME    VALUE" as a command.

### Fix — Three options, in order of preference

#### Option A (preferred): Use indented code in commit messages

Git commit messages render indented blocks as code by convention:

    git commit -m "subject

    body

      EXECUTION_READY        1
      BEHAVIORALLY_DEAD      2
      ECONOMICALLY_BLOCKED   1
      STRUCTURALLY_DEAD      6

    more body"

Four-space (or two-space) indented lines display as a code block in
GitHub's commit UI, with zero bash interaction.

#### Option B: Heredoc-based commit message

    git commit -F - <<'EOF'
    subject

    body

    \`\`\`
    EXECUTION_READY        1
    \`\`\`

    more body
    EOF

Heredoc with quoted delimiter (`'EOF'`) suppresses all bash expansion,
including backticks. Use `-F -` to read the message from stdin.

#### Option C: Escape the backticks

    git commit -m "...
    \\\`\\\`\\\`
    ...
    \\\`\\\`\\\`
    ..."

Works but is hard to read. Avoid unless A and B don't fit.

### History

- 2026-06-04 — `docs(ledger-repair)` commit `bbc0e63`. The commit
  message included a markdown code-fenced scoreboard example. Bash
  interpreted six lines of the scoreboard as commands and produced
  the "command not found" errors. Commit landed; body was minimally
  affected. Lesson logged in this document.

---

## Pitfall 2: Regex-Based Narrative Updates Can Corrupt Unrelated Text

### Symptom

A deploy script uses regex to update a numeric counter in a markdown
document. The regex matches LABEL followed by a digit anywhere on the
same line. If the FIRST occurrence of LABEL+digit is in narrative text
(not in the intended counter section), the regex silently rewrites the
narrative digit instead of the counter.

Concrete examples from `docs/project_ledger.md` (2026-06-04):

- A regex update tried to set `STRUCTURALLY_DEAD` count to `6`. It
  matched the FIRST occurrence of `STRUCTURALLY_DEAD` with a digit
  on the same line — which was the Unichain surface header
  `STRUCTURALLY_DEAD\`** (W7)`. The `7` in `(W7)` became `6`,
  corrupting the surface's wave-number reference.

- A regex update tried to set `BEHAVIORALLY_DEAD` count to `2`. It
  matched the first `BEHAVIORALLY_DEAD` with a digit on the same line —
  the Wave 6 predictive-success narrative containing
  "`BEHAVIORALLY_DEAD\`). Pattern 1 was hypothesized". The `1` in
  "Pattern 1" became `2`, factually corrupting the framework's pattern
  reference.

### Cause

The offending regex (Python):

    rf'({label}[^\d\n]*?)(\d+)'

This pattern matches:
1. The label string
2. Any non-digit, non-newline characters (lazy)
3. The first digit sequence on that line

It has no awareness of WHERE in the document this match occurs. If the
label appears in:
  - the per-chain surface descriptions
  - the wave-by-wave table cells
  - the research mission narrative
  - **anywhere before the intended counter**

...the regex hits there first and corrupts it.

### Fix — Atomic Block Convention

Instead of regex-updating a number embedded in prose, define a dedicated
section with a precise visual format. Update the entire block as a unit
via `str_replace`, never via global regex.

The `docs/project_ledger.md` Scoreboard section (added 2026-06-04) is
the canonical example:

    ## Scoreboard

    Canonical surface count and breakdown by classification. This block has
    a deliberate code-fenced format that future deploys MUST target as a
    single unit via str_replace, never via global regex.

    \`\`\`
    EXECUTION_READY        1   Arbitrum ETH/USDC × Ramses
    BEHAVIORALLY_DEAD      2   Base Slipstream + Optimism Velodrome Slipstream
    ECONOMICALLY_BLOCKED   1   Base ETH/USDC × Aero V2
    STRUCTURALLY_DEAD      6   4× Arbitrum + Unichain + Sonic
                         ─────
    n = 10 surfaces classified
    \`\`\`

To update the scoreboard, capture the entire block (including the
fence markers and label/count/source columns) and replace it as one
str_replace operation. No anchoring on individual labels. No regex
pattern matching against prose.

### Permanent governance principle

**Never use global regex to update specific named values in markdown
documents.** Use either:

1. Explicit-anchor `str_replace` on a known fixed-format block, OR
2. Atomic block replacement (cut entire region and rebuild)

Documents that mix prose and counts should isolate the counts in a
dedicated section with a clearly bounded format.

### History

- 2026-06-04 — `docs(ledger-repair)` commit `bbc0e63` introduced the
  atomic Scoreboard section after diagnosing this corruption pattern.
  Prior commits affected: `wave7(commit 4)` `497b3d1`, `docs(cleanup)`
  `5a011b5`, `wave8(commit 6)` `2c4b361`. Damage was contained to two
  narrative lines; framework data was unaffected because notebook and
  archive were rewritten fresh each commit.

---

## Pitfall 3: `set -o pipefail` + Pipe to `grep -q` (SIGPIPE False Negative)

### Symptom

A deploy script uses `set -o pipefail` and validates its output with a
pattern like `producer | grep -q "pattern"`. Spot-checks report tokens
as MISSING even when those tokens are visibly present in the artifact.
The deploy exits before the commit stage, though everything it wrote
to disk is correct.

Concrete example from Wave 10B c3 (2026-06-05):

    scanner_content=$(cat "${SCANNER_PATH}")
    for token in SCHEMA_VERSION SIZE_LADDER_USD ...; do
      if echo "${scanner_content}" | grep -qF "${token}"; then
        echo "  OK: ${token}"
      else
        echo "  MISSING: ${token}"
        exit 1
      fi
    done

The first token happens to live late in the file, so `echo` flushes its
entire buffer before `grep` matches. Subsequent tokens live earlier in
the file — `grep -q` matches, exits, and `echo` receives SIGPIPE from
the closed downstream pipe. Under `pipefail`, `echo`'s non-zero exit
propagates through the pipeline, so `grep`'s SUCCESS gets reported as
failure and the deploy dies with a false "MISSING" verdict.

### Cause

`grep -q` exits immediately on first match. Under `set -o pipefail`,
the exit status of a pipeline is the exit status of the last command
that returned non-zero, so if any upstream producer receives SIGPIPE
after `grep -q` closes its stdin, the entire pipeline reports failure.

This is orthogonal to WHERE the input comes from. Piping a captured
variable through `echo` has the same SIGPIPE mechanic as piping `cat`
or `git log` directly — the pipe is the problem, not the source.

### Fix — Three options, in order of preference

#### Option A (preferred): Direct-file grep

    grep -qF "$pattern" "$file"

No pipe, no SIGPIPE, no pipefail interaction. Works whenever the
artifact being validated already exists on disk (which for deploy
spot-checks is nearly always true — the file was just written).

#### Option B (acceptable): Herestring

    grep -qF "$pattern" <<< "$variable"

Bash herestring feeds the variable into `grep`'s stdin as a file, not
through a pipeline. Use when the value being checked is only in memory
(e.g. `git log` output that shouldn't be re-invoked).

#### Option C (use deliberately): Subshell pipefail opt-out

    ( set +o pipefail; producer | grep -q "$pattern" )

Explicitly disables `pipefail` for one specific check. Use only when
the producer must be piped and neither A nor B fits. Document why in
a comment next to the check.

### Anti-pattern — NOT a fix

    echo "$captured" | grep -q "$pattern"

Capturing the producer's output to a variable and then piping the
variable through `echo` does not solve the problem. The pipe itself
triggers the SIGPIPE / pipefail interaction. If this pattern appears
in a deploy script, replace it with Option A, B, or C.

### History

- 2026-06-04 — Wave 10B c2 deploy (`33e3830`). The `git log | grep -qE`
  pattern was flagged during authoring and rewritten to capture-then-
  pipe. The rewrite was believed to be a fix but retained the pipe;
  the bug did not fire on c2 only because the checked token happened
  to sit late enough in the log output for `echo` to flush before
  `grep` matched.

- 2026-06-05 — Wave 10B c3 deploy. The same capture-then-pipe pattern
  was used for scanner file spot-checks. It fired on the second token
  (`SIZE_LADDER_USD`, matched early in a 26 KB file), exiting the
  deploy at stage 4 with the scanner correctly on disk but uncommitted.
  Recovery deploy `deploy_w10b_c3_recovery.sh` used Option A (direct-
  file grep) and landed as `fea4def`.

The recurrence across two consecutive deploys is why this was promoted
from an anti-pattern note into a governance lesson.

---

## Operating procedure for future deploys

1. **Commit messages:** Use indented blocks for code-like content, NEVER
   markdown code fences. If you must use markdown fences, use `-F -`
   with a heredoc.

2. **Scoreboard/counter updates:** Target the atomic Scoreboard block
   via `str_replace` of the entire fenced region. Do not regex anywhere
   else in the document.

3. **Audit hooks:** A deploy script that modifies counters should print
   the BEFORE and AFTER scoreboard block to stdout for human verification
   before committing.

4. **Pre-commit sanity:** When in doubt, `cat` the modified file region
   to stdout and visually verify before `git add`/`git commit`.

5. **Artifact validation:** When spot-checking a file the deploy just
   wrote, prefer `grep -qF "$pat" "$file"` over any pipe-based pattern.
   `producer | grep -q` under `set -o pipefail` can report false
   negatives via the SIGPIPE mechanic documented in Pitfall 3.

---

## Cross-references

- DEX integration pitfalls: [`dex_contract_discovery_pitfalls.md`](dex_contract_discovery_pitfalls.md)
- Project ledger (canonical research index): [`../project_ledger.md`](../project_ledger.md)
- Research notebook: [`../research/ramses_class_surface_characteristics.md`](../research/ramses_class_surface_characteristics.md)
