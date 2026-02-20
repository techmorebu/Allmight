#!/usr/bin/env python3
"""
Fixes _fee_to_bps threshold in both L2 adapters.
Problem: 0.05 (UniV3 percent) was being caught by fee < 0.1 -> x10000 = 500 bps
Fix: split at 0.01 instead of 0.1
  < 0.01 = raw fraction (0.003 -> 30 bps)
  < 5    = percent      (0.05 -> 5 bps, 0.3 -> 30 bps)
  else   = already bps

Run: python3 fix_fees2.py
"""
import os, sys

ROOT = os.path.expanduser("~/Allmight/scripts/market/redis_adapters")

NEW_FEE_FUNC = '''\
def _fee_to_bps(fee):
    if fee is None: return 30.0
    # Fee encoding by venue:
    #   UniV3:          0.05 (percent) -> 5 bps    [fee >= 0.01]
    #   UniV3:          0.3  (percent) -> 30 bps   [fee >= 0.01]
    #   Camelot/Aero:   0.003 (fraction) -> 30 bps [fee < 0.01]
    #   Aero stable:    0.0001 (fraction) -> 1 bps  [fee < 0.01]
    if fee < 0.01: return fee * 10000   # raw fraction -> bps
    if fee < 5:    return fee * 100     # percent -> bps
    return float(fee)                   # already bps

'''

for fname in ("arbitrum.py", "base.py"):
    path = os.path.join(ROOT, fname)
    with open(path) as f:
        lines = f.readlines()

    start = end = None
    for i, line in enumerate(lines):
        if line.strip().startswith("def _fee_to_bps"):
            start = i
        if start is not None and i > start and line.strip().startswith("def "):
            end = i
            break
    if end is None and start is not None:
        end = start + 12

    if start is None:
        print(f"ERROR: _fee_to_bps not found in {fname}")
        continue

    new_lines = lines[:start] + [NEW_FEE_FUNC] + lines[end:]
    with open(path, "w") as f:
        f.writelines(new_lines)
    print(f"OK {fname}")

print()
print("Verifying fee conversion:")
sys.path.insert(0, os.path.expanduser("~/Allmight"))

import importlib
import scripts.market.redis_adapters.arbitrum as arb_mod
importlib.reload(arb_mod)

tests = [
    (0.003,  30.0,  "Camelot 0.3%"),
    (0.0001,  1.0,  "Aero stable 0.01%"),
    (0.05,    5.0,  "UniV3 0.05%"),
    (0.3,    30.0,  "UniV3 0.3%"),
    (5.0,     5.0,  "already bps"),
    (30.0,   30.0,  "already bps"),
]

all_ok = True
for val, expected, label in tests:
    result = arb_mod._fee_to_bps(val)
    ok = abs(result - expected) < 0.01
    if not ok: all_ok = False
    print(f"  {'OK  ' if ok else 'FAIL'} {label:<22} _fee_to_bps({val}) = {result:.1f}  (expected {expected:.1f})")

print()
if all_ok:
    print("All tests passed.")
    print("Run: python3 scripts/run_reality_check.py --single --tier 1000 --chain all")
else:
    print("FAILURES -- fix logic")
