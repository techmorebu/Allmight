# Appendix — Paste Corruption Field Guide (AllMight)

This appendix exists because paste corruption is not a “user issue” — it’s a predictable failure mode.

## When to use wpb
Use `wpb` when you are pasting Python ONLY, especially Python-writer blocks that create/patch files.

Good uses:
- Writing docs/*.md, docs/*.txt, config/*.json via Path(...).write_text(...)
- Deterministic patch scripts
- Repo artifact generators (wrap files, scan reports)

Never use `wpb` for:
- shell commands (apt, git, ls, cd, pytest, etc.)

## When to use wps
Use `wps` only for short shell sequences that you could safely type.
Avoid multi-hundred-line pastes through wps.

## Classic failure signatures
- `SyntaxError: invalid syntax` pointing at `sudo`, `cd`, `ls`, `cat`
  -> you ran shell in python (wpb)
- `IndentationError: unexpected indent` after multiple wpb attempts
  -> partial paste inserted spaces or clipped a block
- `from __future__ imports must occur at the beginning of the file`
  -> file got a stray line above future import (paste corruption)

## Recovery protocol
1) Stop. Do not keep “patching the patch”.
2) Re-open the file and inspect the top ~40 lines.
3) If it’s a test: replace file with a clean deterministic version via Python-writer.
4) Re-run pytest to confirm collection works.

## Golden rule
Small chunks beat “one mega paste”.
