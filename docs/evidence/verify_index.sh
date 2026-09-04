#!/usr/bin/env bash
# Verify every artifact in EVIDENCE_INDEX.md against its recorded sha256.
set -u
DIR="${1:-.}"
IDX="$(cd "$(dirname "$0")" && pwd)/EVIDENCE_INDEX.md"
[ -f "$IDX" ] || { echo "EVIDENCE_INDEX.md not found"; exit 2; }
ok=0; bad=0; missing=0; checked=0
echo "Verifying artifacts in: $DIR"
echo "=================================================================="
while IFS= read -r line; do
  art=$(echo "$line" | grep -oE '`W11_[A-Za-z0-9_]+\.zip`' | tr -d '`')
  sha=$(echo "$line" | grep -oE '`[0-9a-f]{64}`' | tr -d '`')
  [ -n "$art" ] && [ -n "$sha" ] || continue
  checked=$((checked+1))
  f="$DIR/$art"
  if [ ! -f "$f" ]; then printf "  MISSING  %s\n" "$art"; missing=$((missing+1)); continue; fi
  got=$(sha256sum "$f" | cut -c1-64)
  if [ "$got" = "$sha" ]; then printf "  OK       %s\n" "$art"; ok=$((ok+1))
  else printf "  MISMATCH %s\n             recorded %s\n             actual   %s\n" "$art" "$sha" "$got"; bad=$((bad+1)); fi
done < "$IDX"
echo "=================================================================="
echo "  indexed $checked   ok $ok   mismatch $bad   missing $missing"
# A run that checked NOTHING must never report success. That vacuous-pass shape
# is the exact failure class this project has repeatedly had to correct.
if [ "$checked" -eq 0 ]; then
  echo "  FAIL: the index yielded ZERO artifacts — parser or index defect, not a clean archive"
  exit 3
fi
if [ "$bad" -eq 0 ] && [ "$missing" -eq 0 ]; then echo "  ARCHIVE VERIFIED"; exit 0
else echo "  ARCHIVE NOT VERIFIED"; exit 1; fi
