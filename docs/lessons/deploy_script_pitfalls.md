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

---

## Cross-references

- DEX integration pitfalls: [`dex_contract_discovery_pitfalls.md`](dex_contract_discovery_pitfalls.md)
- Project ledger (canonical research index): [`../project_ledger.md`](../project_ledger.md)
- Research notebook: [`../research/ramses_class_surface_characteristics.md`](../research/ramses_class_surface_characteristics.md)
