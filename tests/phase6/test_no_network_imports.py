from __future__ import annotations

import ast
from pathlib import Path


BANNED_IMPORT_PREFIXES = [
    "requests",
    "httpx",
    "aiohttp",
    "web3",
    "ccxt",
    "websocket",
    "websockets",
    "socket",
]


def _imports_in_file(py_path: Path) -> list[str]:
    tree = ast.parse(py_path.read_text(encoding="utf-8"))
    mods: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                mods.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                mods.append(node.module)
    return mods


def test_phase6_runner_has_no_network_imports():
    runner = Path("scripts/phase6/run_phase6_build_execution_plans.py")
    imports = _imports_in_file(runner)

    banned = []
    for imp in imports:
        for pref in BANNED_IMPORT_PREFIXES:
            if imp == pref or imp.startswith(pref + "."):
                banned.append(imp)

    assert banned == [], f"Phase6 must be dry-run only. Banned imports found: {banned}"
