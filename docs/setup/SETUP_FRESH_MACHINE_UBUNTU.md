# AllMight — Fresh Machine Setup (Ubuntu)

This document is the canonical “new machine from scratch” bootstrap for AllMight.
It is written to reduce recurring failures: clipboard/paste corruption, missing deps,
missing replay artifacts, PYTHONPATH import errors, and GitHub auth friction.

Target environment
- Ubuntu (desktop), Wayland session preferred
- Python venv per-repo
- GitHub auth via GitHub CLI (gh)
- Clipboard helpers: wl-clipboard (Wayland) + optional xclip (X11 fallback)

------------------------------------------------------------
0) Operator rule: paste corruption prevention
------------------------------------------------------------

Use these tools ONLY:
- `wpb` = Wayland clipboard -> python runner
- `wps` = Wayland clipboard -> shell runner (SAFE small commands only)
Never run shell commands through `wpb`. `wpb` executes clipboard as Python.

If you see:
- `SyntaxError: invalid syntax` after a shell command: you accidentally ran shell in `wpb`.
- `from __future__ imports must occur...`: clipboard contained mixed/partial python due to paste corruption.

Recommended daily discipline:
- Use `wpb` ONLY for Python-writer file creation/patching.
- Use terminal typing or `wps` for shell commands.
- Prefer small chunks. Avoid giant pastes into terminal.

------------------------------------------------------------
1) Confirm session + clipboard toolchain (Wayland-safe)
------------------------------------------------------------

Check session:
  echo "session=${XDG_SESSION_TYPE:-unset}"
  echo "wayland_display=${WAYLAND_DISPLAY:-unset}"

Install clipboard tools:
  sudo apt update
  sudo apt install -y wl-clipboard

Optional (X11 fallback only):
  sudo apt install -y xclip

Canonical wpb (Wayland):
- File: ~/.local/bin/wpb
- Behavior: run clipboard as python

Canonical wps (Wayland):
- File: ~/.local/bin/wps
- Behavior: run clipboard as shell

NOTE: Wayland is the canonical target going forward.

------------------------------------------------------------
2) Install baseline packages
------------------------------------------------------------

  sudo apt update
  sudo apt install -y \
    git \
    python3 \
    python3-venv \
    python3-pip \
    build-essential \
    curl

(If tests require it:)
  sudo apt install -y python3-pytest

------------------------------------------------------------
3) GitHub auth (Option A: GitHub CLI) — CANONICAL
------------------------------------------------------------

Install:
  sudo apt install -y gh

Login (stores token securely):
  gh auth login

Setup git credential flow:
  gh auth setup-git

Verify:
  gh auth status
  git remote -v

Push should now work without username/password prompts:
  git push

------------------------------------------------------------
4) Clone repo + create venv
------------------------------------------------------------

  mkdir -p ~/code
  cd ~/code
  git clone https://github.com/techmorebu/Allmight.git
  cd Allmight

Create venv:
  python3 -m venv .venv
  source .venv/bin/activate

Upgrade pip tooling:
  python -m pip install -U pip wheel setuptools

------------------------------------------------------------
5) Install Python deps (minimum needed for data pipeline)
------------------------------------------------------------

Install core runtime deps:
  pip install -U pandas ccxt

Install test deps (if not already pinned in repo):
  pip install -U pytest

NOTE:
If the repo has a requirements file, prefer it:
  pip install -r requirements.txt
or:
  pip install -r requirements-dev.txt

------------------------------------------------------------
6) Environment variables (import stability)
------------------------------------------------------------

In repo root:
  export PYTHONPATH="$PWD"

This prevents:
  ModuleNotFoundError: No module named 'scripts'

Optional: add to venv activation (advanced, only if desired).

------------------------------------------------------------
7) Canonical replay pipeline (15m grid) — known-good sequence
------------------------------------------------------------

Goal: produce the artifacts Phase 4 expects under outputs/replay and outputs/phase4.

A) Create staging dir:
  mkdir -p data/staging outputs

B) Ingest to staging (example 15m grid):
  python scripts/data/ingest_coinbase_to_staging.py --symbol BTC/USD  --assetid BTC --timeframe 15m
  python scripts/data/ingest_coinbase_to_staging.py --symbol ETH/USD  --assetid ETH --timeframe 15m
  python scripts/data/ingest_coinbase_to_staging.py --symbol XRP/USD  --assetid XRP --timeframe 15m
  python scripts/data/ingest_coinbase_to_staging.py --symbol PAXG/USD --assetid XAU --timeframe 15m

C) Build replay windows (single mode avoids missing other timeframes):
  python scripts/data/replay_ohlcv_window.py --asset BTC --timeframe 15m --wipe
  python scripts/data/replay_ohlcv_window.py --asset ETH --timeframe 15m
  python scripts/data/replay_ohlcv_window.py --asset XRP --timeframe 15m
  python scripts/data/replay_ohlcv_window.py --asset XAU --timeframe 15m

D) Ensure outputs/replay points to processed replay dir
(Phase scripts expect outputs/replay/*)
  rm -rf outputs/replay
  ln -s ../data/processed/replay outputs/replay

E) Shared inputs (last + i60)
  python scripts/shared_inputs/calc_shared_inputs_replay.py \
    --input outputs/replay/ohlcv_replay_BTC_15m.csv \
    --asof-index -1 \
    --output outputs/replay/shared_inputs_GRID_BTC_ETH_XRP_XAU_15m_last.csv

  python scripts/shared_inputs/calc_shared_inputs_replay.py \
    --input outputs/replay/ohlcv_replay_BTC_15m.csv \
    --asof-index -60 \
    --output outputs/replay/shared_inputs_GRID_BTC_ETH_XRP_XAU_15m_i60.csv

F) Pressure grid (writes structure_l0 + pressure_l1 for last + i60 in one run)
  python scripts/pressure/run_pressure_grid.py \
    --assets BTC,ETH,XRP,XAU \
    --timeframe 15m \
    --n 200 \
    --asof-index 199 \
    --i60-offset 60

G) Regime replay
If Phase 3 component CSVs are not available yet, allow missing components:
  python scripts/regime/run_regime_replay.py --asof-label last --allow-missing-components
  python scripts/regime/run_regime_replay.py --asof-label i60  --allow-missing-components

H) Phase 4 component build (writes sweep_l2, liquidity_arch_l3, macro_score, risk_penalty)
  python scripts/phase4/build_components_asof.py --asof last
  python scripts/phase4/build_components_asof.py --asof i60

I) Phase 4 control layer (writes outputs/phase4/*.json)
  python scripts/phase4/run_phase4_control_layer.py --asof last
  python scripts/phase4/run_phase4_control_layer.py --asof i60

------------------------------------------------------------
8) Tests (canonical)
------------------------------------------------------------

  pytest -q

If tests fail due to replay-data variability, tests MUST be data-independent.
Do not “pin” assumptions like confidence < 0.25 unless the test explicitly constructs the condition.

------------------------------------------------------------
9) Common failures + fixes (battle-tested)
------------------------------------------------------------

A) wl-paste errors / Wayland socket missing
- Check:
    echo $XDG_SESSION_TYPE
- If x11: wl-paste will fail. Either switch to Wayland or use xclip-based wpb.
- Canonical path forward: Wayland session.

B) `ModuleNotFoundError: scripts`
- Fix:
    export PYTHONPATH="$PWD"

C) `Missing staging CSV: data/staging/ohlcv_staging.csv`
- Fix:
    mkdir -p data/staging
    run ingest_coinbase_to_staging.py with required args

D) `replay_ohlcv_window.py --all` fails many timeframes
- Cause: config expects more assets/timeframes than you ingested.
- Fix: use single-asset mode (BTC/ETH/XRP/XAU 15m) as above.

E) Regime replay missing structure_l0
- Fix: run pressure grid first (it writes structure_l0_*).

F) Regime replay missing SweepScore
- Fix: either provide Phase 3 CSVs OR run with:
    --allow-missing-components

G) Paste corruption
- Symptom: random indentation errors or mixed shell/python in a Python file.
- Fix: stop pasting huge blocks; use wpb only for python-writer patches.

------------------------------------------------------------
10) Final sanity (before doing “real work”)
------------------------------------------------------------

  python -m py_compile scripts/phase4/run_phase4_control_layer.py
  pytest -q
  git status

