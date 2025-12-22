#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$ROOT/docs/_incoming_docs"
OUT_DIR="$ROOT/docs/specs"
WORK_DIR="$ROOT/docs/_sources/unified_master"
PATCH_DIR="$ROOT/docs/patches"

MASTER_OUT="$OUT_DIR/UNIFIED_MASTER_CANONICAL.md"
PATCH_LEDGER="$OUT_DIR/PATCH_LEDGER.md"

mkdir -p "$WORK_DIR" "$OUT_DIR" "$PATCH_DIR"

echo "==> Collecting sources from: $SRC_DIR"
ls -la "$SRC_DIR" || true

# Helpers
have() { command -v "$1" >/dev/null 2>&1; }

extract_pdf () {
  local in="$1" out="$2"
  if have pdftotext; then
    pdftotext -layout "$in" "$out"
  else
    echo "[WARN] pdftotext missing; install poppler-utils"
    return 1
  fi
}

extract_docx () {
  local in="$1" out="$2"
  if have pandoc; then
    pandoc "$in" -t plain -o "$out"
  elif have docx2txt; then
    docx2txt "$in" "$out" >/dev/null
  else
    echo "[WARN] pandoc/docx2txt missing; install one of them"
    return 1
  fi
}

# 1) Extract primary sources (best-effort)
echo "==> Extracting source texts..."

# Expected filenames (after your Stage 5 normalization)
PDF_OVERVIEW="$SRC_DIR/AllMight project overview.pdf"
DOCX_OVERVIEW="$SRC_DIR/AllMight project overview.docx"

ARCH_PDF="$SRC_DIR/Architecture.pdf"
UPGRADE_PDF="$SRC_DIR/Upgrade_Roadmap.pdf"
PHIL_DOCX="$SRC_DIR/FINAL_PHILOSOPHY_INDEX_AUTHORITATIVE.docx"

# Extract overview PDF/DOCX (these contain the Unified Master v2.1 and patches)
[ -f "$PDF_OVERVIEW" ]  && extract_pdf  "$PDF_OVERVIEW"  "$WORK_DIR/overview_pdf.txt"  || true
[ -f "$DOCX_OVERVIEW" ] && extract_docx "$DOCX_OVERVIEW" "$WORK_DIR/overview_docx.txt" || true

# Extract supporting sources (optional)
[ -f "$ARCH_PDF" ]      && extract_pdf  "$ARCH_PDF"      "$WORK_DIR/architecture.txt"  || true
[ -f "$UPGRADE_PDF" ]   && extract_pdf  "$UPGRADE_PDF"   "$WORK_DIR/upgrade.txt"       || true
[ -f "$PHIL_DOCX" ]     && extract_docx "$PHIL_DOCX"     "$WORK_DIR/philosophy.txt"    || true

echo "==> Building canonical master: $MASTER_OUT"

# 2) Assemble canonical markdown
cat > "$MASTER_OUT" <<'MD'
# ALLMIGHT — UNIFIED MASTER (CANONICAL)

Status:
- Phase 1: **LOCKED**
- Phase 2: **ACTIVE**
- Execution: **DISABLED** (shadow evaluation only)

This canonical file is an assembled master derived from the authoritative overview sources and approved patches.
It is designed to be the single “front door” for the project.

---

## 0) Purpose

AllMight is a local-only, self-upgrading, AI-driven arbitrage and compounding system:
- scans CEX + DEX + cross-chain inefficiencies
- runs signal fusion and local AI inference
- executes optimized routes (future phases only)
- reinvests profits into hardware upgrades
- supports multi-node scaling over time

---

## 1) Phase Structure

- Phase 0 — Paper Brain
- Phase 1 — Data & Replay Engines (LOCKED)
- Phase 2 — Regime & Confluence (ACTIVE, SHADOW MODE)
- Phase 3 — Supercycle ATM Engine (future)
- Phase 4 — Instability Index + MetalAllocator (future)

---

## 2) System Architecture

MD

# Append extracted architecture content if available
if [ -f "$WORK_DIR/architecture.txt" ]; then
  echo "### Architecture Source Extract" >> "$MASTER_OUT"
  echo "" >> "$MASTER_OUT"
  sed -n '1,260p' "$WORK_DIR/architecture.txt" >> "$MASTER_OUT"
  echo "" >> "$MASTER_OUT"
fi

# Append extracted upgrade content if available
cat >> "$MASTER_OUT" <<'MD'
---

## 3) Hardware Upgrade Roadmap (Summary)

MD
if [ -f "$WORK_DIR/upgrade.txt" ]; then
  echo "### Upgrade Roadmap Source Extract" >> "$MASTER_OUT"
  echo "" >> "$MASTER_OUT"
  sed -n '1,260p' "$WORK_DIR/upgrade.txt" >> "$MASTER_OUT"
  echo "" >> "$MASTER_OUT"
fi

# Append philosophy (read-only)
cat >> "$MASTER_OUT" <<'MD'
---

## 4) Philosophy (READ-ONLY, NON-EXECUTABLE)

This section is context only. It must never override execution logic.

MD
if [ -f "$WORK_DIR/philosophy.txt" ]; then
  echo "### Philosophy Source Extract" >> "$MASTER_OUT"
  echo "" >> "$MASTER_OUT"
  sed -n '1,260p' "$WORK_DIR/philosophy.txt" >> "$MASTER_OUT"
  echo "" >> "$MASTER_OUT"
fi

# 3) Patch Ledger (we keep it explicit and auditable)
echo "==> Building patch ledger: $PATCH_LEDGER"
cat > "$PATCH_LEDGER" <<'MD'
# Patch Ledger (Approved / Known)

This file indexes patches detected inside the overview sources.

Known patches present in overview sources include (not exhaustive):
- Unified Master v2.0.1 — Turning Point Projection Engine (minor enhancement)
- Unified Master v2.0.2 — Macro Philosophy & Narrative Immunity
- Unified Master v2.0.4 — Final Philosophy Capstone (philosophy freeze)
- AM-PATCH-2.2.1 — CUDA Tile Batch Build Prompt + integration addendum

Each patch should eventually be split into its own file under `docs/patches/` for clean diffs.

MD

# Grep patch blocks out of extracted overview text (best-effort)
for f in "$WORK_DIR/overview_pdf.txt" "$WORK_DIR/overview_docx.txt"; do
  [ -f "$f" ] || continue
  echo "" >> "$PATCH_LEDGER"
  echo "## Extracted markers from: $(basename "$f")" >> "$PATCH_LEDGER"
  echo "" >> "$PATCH_LEDGER"
  grep -nE "UNIFIED MASTER|PATCH ID:|AM-PATCH|VERSION [0-9]+\.[0-9]+" "$f" | head -n 200 >> "$PATCH_LEDGER" || true
done

echo "==> Done."
echo "Generated:"
echo " - $MASTER_OUT"
echo " - $PATCH_LEDGER"
