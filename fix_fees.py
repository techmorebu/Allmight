#!/usr/bin/env python3
"""
Fixes _fee_to_bps in both L2 adapters using line-number replacement.
Run: python3 fix_fees.py
"""
import os

ROOT = os.path.expanduser("~/Allmight/scripts/market/redis_adapters")

NEW_FEE_FUNC = """\
def _fee_to_bps(fee):
    if fee is None: return 30.0
    # UniV3 fees stored as percent:     0.05 -> 5 bps,  0.3 -> 30 bps
    # Camelot/Aerodrome stored as frac: 0.003 -> 30 bps, 0.0001 -> 1 bps
    if fee < 0.1: return fee * 10000
    if fee < 5:   return fee * 100
    return float(fee)
"""

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
        end = start + 10  # function is short, grab enough lines

    if start is None:
        print(f"ERROR: _fee_to_bps not found in {fname}")
        continue

    new_lines = lines[:start] + [NEW_FEE_FUNC + "\n"] + lines[end:]
    with open(path, "w") as f:
        f.writelines(new_lines)
    print(f"OK {fname} (replaced lines {start+1}-{end})")

print("\nVerifying:")
import sys
sys.path.insert(0, os.path.expanduser("~/Allmight"))
for val, expected in [(0.003, 30.0), (0.05, 5.0), (0.3, 30.0), (0.0001, 1.0)]:
    from scripts.market.redis_adapters.arbitrum import _fee_to_bps
    result = _fee_to_bps(val)
    status = "OK" if abs(result - expected) < 0.01 else "FAIL"
    print(f"  {status} _fee_to_bps({val}) = {result} (expected {expected})")
