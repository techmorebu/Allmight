#!/usr/bin/env bash
# Clean C9 state to Boss-canonical 3 sessions only.
# Boss ruling 2026-05-05: keep only 20260428_2329, 20260503_1948, 20260505_0755.
# Removes: 20260422_2223, 20260428_0817, 20260502_0426, "YYYYMMDD_HHMM" sentinel.
set -euo pipefail

cd ~/Allmight
F="logs/.dryrun_c9_confirmed.json"

# Backup first — never destructive without rollback
cp "$F" "${F}.bak.$(date +%Y%m%d_%H%M%S)"

# Rebuild the file with only canonical keys (atomic write via tmp file)
python3 - "$F" <<'PY'
import json, sys, os
path = sys.argv[1]
with open(path) as f:
    state = json.load(f)
canonical = {"20260428_2329", "20260503_1948", "20260505_0755"}
cleaned = {k: True for k in sorted(canonical) if state.get(k) is True}
missing = canonical - set(cleaned.keys())
if missing:
    print(f"ERROR: canonical sessions missing from state: {missing}", file=sys.stderr)
    sys.exit(1)
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(cleaned, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
print(f"OK: state cleaned to {len(cleaned)} canonical entries")
PY

echo "── verification ──"
python3 -m json.tool "$F"
