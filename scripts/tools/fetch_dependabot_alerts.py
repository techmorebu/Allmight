#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path


def _req(url: str, token: str):
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    return req


def main() -> int:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: GITHUB_TOKEN is not set.", file=sys.stderr)
        print("Hint: run like: GITHUB_TOKEN=... python scripts/tools/fetch_dependabot_alerts.py", file=sys.stderr)
        return 2

    owner = os.environ.get("GITHUB_OWNER", "techmorebu")
    repo = os.environ.get("GITHUB_REPO", "Allmight")

    out_dir = Path("docs/hygiene")
    out_dir.mkdir(parents=True, exist_ok=True)

    alerts = []
    page = 1
    while True:
        url = f"https://api.github.com/repos/{owner}/{repo}/dependabot/alerts?per_page=100&page={page}"
        with urllib.request.urlopen(_req(url, token)) as r:
            batch = json.loads(r.read().decode("utf-8"))
        if not batch:
            break
        alerts.extend(batch)
        page += 1

    out_path = out_dir / "dependabot_alerts.json"
    out_path.write_text(json.dumps(alerts, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(f"Wrote {out_path} ({len(alerts)} alerts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
