# Phase 0 Source PDFs

## Runtime constants (retained)

Current runtime regime constants live at:
- `scripts/regime/phase0_regime_constants.json` — authoritative constants
  file consumed by the regime detection subsystem

## Historical extraction (archived)

The Phase 0 specification PDFs and the extraction workflow that produced
labels, thresholds, and rule text from Tabs 40–45 (`Phase 0 workbook.pdf`,
`Phase 0 Blueprint — Final Edition.pdf`, `scripts/regime/extract_phase0_regime_spec.py`,
and the extraction spec doc) are archived as historical evidence in the
external `W11_CLEANUP_BUNDLE` historical archive. They are preserved for
reproducibility of how the current constants were derived, but they are
not part of the active runtime.

If the constants file needs to be regenerated or amended, restore the
extraction toolchain from the historical archive as a deliberate,
scoped operation — do not re-add it silently.

