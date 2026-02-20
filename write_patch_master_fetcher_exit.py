#!/usr/bin/env python3
"""
Patch: adds process.exit(0) to master-fetcher.js one-shot mode.
Run from project root: python3 write_patch_master_fetcher_exit.py
"""
import os

TARGET = os.path.expanduser("~/Allmight/scripts/master-fetcher.js")

OLD = '        log("info", "One-shot fetchers run completed");'
NEW = '        log("info", "One-shot fetchers run completed");\n        process.exit(0);'

with open(TARGET, "r") as f:
    content = f.read()

if OLD not in content:
    print("❌ Could not find target line — already patched or file changed.")
    print("   Looking for:", repr(OLD))
else:
    content = content.replace(OLD, NEW, 1)
    with open(TARGET, "w") as f:
        f.write(content)
    print(f"✅ Patched {TARGET}")
    print("   Added: process.exit(0) after one-shot completion log")
