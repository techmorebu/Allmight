# Contributing (Allmight)

## 🚫 Terminal paste corruption: mandatory workflow rule (Method 1)

This repo is developed in environments where multi-line terminal paste can corrupt content.
Therefore:

### ✅ Allowed ways to create/patch files
1) **Python-writer pattern (preferred)**
   - Use a Python one-liner to write/patch files.
   - Example:
     - `python - <<'PY' ... Path("path").write_text("...") ... PY`

2) **Wayland clipboard-to-file (patches / long text)**
   - Copy content into clipboard, then write it to disk without pasting:
     - `wl-paste --no-newline > /tmp/patch.diff`
     - `git apply --index /tmp/patch.diff`

### ❌ Not allowed
- Pasting multi-line patches or scripts directly into the terminal.
- Pasting content that includes prompts like `(.venv) user@host:$` or mixed outputs.

### Rationale
Paste corruption creates silent syntax errors, broken patches, and time-wasting debugging.
This rule keeps builds deterministic and auditable.

## Style + hygiene
- Keep scripts deterministic and replay-safe (no lookahead).
- Prefer explicit schemas; validate inputs; fail loudly.
- Add tests for any new replay generator or CLI change.

## Wayland-safe execution (mandatory)

This repo has a strict rule to prevent terminal paste corruption.

- For any multi-line commands, patches, or scripts, **do not paste directly into the terminal**.
- Copy the block and execute via:

```bash
wl-paste --no-newline | bash
```

For python-only blocks:

```bash
wl-paste --no-newline | python
```

Full policy lives in the current governance docs:
- `docs/current/SYSTEM_GUARDRAILS.md` — binding invariants
- `docs/current/ARCHITECTURE_LOCK.md` — architectural invariants

