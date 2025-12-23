# Phase 0 Source PDFs (Authoritative Inputs)

Place the Phase 0 specification PDFs here so Phase 2 extraction is repeatable and version-controlled.

Expected filenames (preferred):
- `Phase 0 workbook.pdf`
- `Phase 0 Blueprint — Final Edition.pdf`

If your filenames differ, update `scripts/regime/extract_phase0_regime_spec.py` accordingly.

Why this exists:
- Phase 2 regime thresholds must be Excel-faithful to Tabs 40–45.
- We extract labels, thresholds, and rule text from these PDFs to produce:
  - `docs/specs/PHASE-2-REGIME-EXTRACTION.md`
  - `scripts/regime/phase0_regime_constants.json`
