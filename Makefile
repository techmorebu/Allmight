SHELL := /bin/bash
PY := .venv/bin/python
PIP := .venv/bin/pip

# ---- Defaults (override like: make replay ASSET=ETH TF=15m ASOF=60) ----
ASSET ?= BTC
TF ?= 15m
ASOF ?= 60

# Optional: comma-separated list for grid runs
ASSETS ?= BTC,ETH,XRP,XAU

# ---- Paths (adjust if your scripts live elsewhere) ----
REPLAY_WINDOW := scripts/data/replay_ohlcv_window.py
SHARED_INPUTS := scripts/shared_inputs/calc_shared_inputs_replay.py
STRUCTURE_L0  := scripts/structure/calc_structure_l0_replay.py
PRESSURE_L1   := scripts/pressure/calc_pressure_replay.py

# Phase 2 placeholder runner (we’ll create it below)
PHASE2_SHADOW := scripts/runners/phase2_shadow_eval.py

.PHONY: help venv deps format lint test \
        replay-window shared-inputs structure-l0 pressure-l1 \
        replay replay-grid phase2-shadow clean

help:
	@echo ""
	@echo "AllMight Makefile Targets"
	@echo "------------------------"
	@echo "setup:"
	@echo "  make venv           - create .venv"
	@echo "  make deps           - install requirements"
	@echo ""
	@echo "phase1 (LOCKED) runners:"
	@echo "  make replay-window  - build replay window for ASSET/TF/ASOF"
	@echo "  make shared-inputs  - shared inputs replay-relative"
	@echo "  make structure-l0   - structure L0 replay-relative"
	@echo "  make pressure-l1    - pressure L1 replay-relative"
	@echo "  make replay         - run shared-inputs + structure-l0 + pressure-l1"
	@echo "  make replay-grid    - run replay over ASSETS (comma-separated)"
	@echo ""
	@echo "phase2 (ACTIVE) runners:"
	@echo "  make phase2-shadow  - run Phase 2 shadow evaluation (no execution)"
	@echo ""
	@echo "hygiene:"
	@echo "  make lint           - ruff/flake (if installed)"
	@echo "  make test           - pytest (if installed)"
	@echo "  make clean          - remove __pycache__ and temp files"
	@echo ""
	@echo "Overrides:"
	@echo "  ASSET=BTC TF=15m ASOF=60 ASSETS=BTC,ETH,XRP,XAU"
	@echo ""

venv:
	@test -d .venv || python3 -m venv .venv
	@$(PIP) -q install --upgrade pip

deps: venv
	@test -f requirements.txt || (echo "requirements.txt not found" && exit 1)
	@$(PIP) install -r requirements.txt

replay-window:
	@test -f $(REPLAY_WINDOW) || (echo "Missing: $(REPLAY_WINDOW)" && exit 1)
	@$(PY) $(REPLAY_WINDOW) --asset $(ASSET) --timeframe $(TF) --asof-index $(ASOF)

shared-inputs:
	@test -f $(SHARED_INPUTS) || (echo "Missing: $(SHARED_INPUTS)" && exit 1)
	@$(PY) $(SHARED_INPUTS) --asset $(ASSET) --timeframe $(TF) --asof-index $(ASOF)

structure-l0:
	@test -f $(STRUCTURE_L0) || (echo "Missing: $(STRUCTURE_L0)" && exit 1)
	@$(PY) $(STRUCTURE_L0) --asset $(ASSET) --timeframe $(TF) --asof-index $(ASOF)

pressure-l1:
	@test -f $(PRESSURE_L1) || (echo "Missing: $(PRESSURE_L1)" && exit 1)
	@$(PY) $(PRESSURE_L1) --asset $(ASSET) --timeframe $(TF) --asof-index $(ASOF)

replay: shared-inputs structure-l0 pressure-l1
	@echo "Replay run complete: ASSET=$(ASSET) TF=$(TF) ASOF=$(ASOF)"

replay-grid:
	@echo "Running replay grid over: $(ASSETS)"
	@$(PY) scripts/runners/replay_grid.py --assets "$(ASSETS)" --timeframe "$(TF)" --asof-index "$(ASOF)"

phase2-shadow:
	@test -f $(PHASE2_SHADOW) || (echo "Missing runner: $(PHASE2_SHADOW)" && exit 1)
	@$(PY) $(PHASE2_SHADOW) --assets "$(ASSETS)" --timeframe "$(TF)" --asof-index "$(ASOF)"

lint:
	@command -v ruff >/dev/null 2>&1 && ruff check . || echo "ruff not installed (skip)"

test:
	@command -v pytest >/dev/null 2>&1 && pytest -q || echo "pytest not installed (skip)"

clean:
	@find . -type d -name "__pycache__" -prune -exec rm -rf {} \; || true
	@find . -type f -name "*.pyc" -delete || true
	@find . -type f -name ".DS_Store" -delete || true
