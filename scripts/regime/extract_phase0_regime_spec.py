from __future__ import annotations

import subprocess
from pathlib import Path

KEYWORDS = r"TAB 4[0-6]|Regime|Classification|Weight Profiles|Genetic Weight|Liquidity Migration|Macro-Micro Bridge|Cross-Market Triggers|RISK_ON|RISK_OFF|PANIC|TRANSITION"

PDFS = [
    Path("docs/source_pdfs/Phase 0 workbook.pdf"),
    Path("docs/source_pdfs/Phase 0 Blueprint — Final Edition.pdf"),
    Path("docs/source_pdfs/Phase 0 Blueprint — Final Edition Appended.pdf"),
]

OUT_DIR = Path("docs/specs")
OUT_DIR.mkdir(parents=True, exist_ok=True)

RAW_OUT = OUT_DIR / "PHASE-2-REGIME-PDF-GREP.txt"
CURATED_OUT = OUT_DIR / "PHASE-2-REGIME-EXTRACTION.md"


def _require_file(p: Path) -> None:
    if not p.exists():
        raise SystemExit(
            f"Missing required PDF: {p}\n"
            f"Put Phase 0 PDFs into docs/source_pdfs/ (see docs/source_pdfs/README.md)."
        )


def _pdftotext_grep(pdf: Path) -> str:
    # pdftotext to stdout, then ripgrep
    cmd = f'pdftotext "{pdf}" - | rg -n "{KEYWORDS}"'
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if r.returncode not in (0, 1):
        raise SystemExit(f"Command failed: {cmd}\n{r.stderr}")
    return r.stdout.strip()


def main() -> None:
    for p in PDFS:
        _require_file(p)

    sections = []
    for pdf in PDFS:
        hit = _pdftotext_grep(pdf)
        header = f"## Source: {pdf}\n"
        body = hit if hit else "(no matches found)"
        sections.append(header + "```\n" + body + "\n```\n")

    RAW_OUT.write_text("\n\n".join(sections) + "\n", encoding="utf-8")

    CURATED_OUT.write_text(
        "# Phase 2 Regime Extraction (Phase 0 Tabs 40–45)\n\n"
        "This file is generated from Phase 0 PDFs placed in `docs/source_pdfs/`.\n\n"
        "## Next steps (manual, deterministic)\n"
        "- Review `PHASE-2-REGIME-PDF-GREP.txt`\n"
        "- Identify explicit regime labels, thresholds, and rule text for Tabs 40–45\n"
        "- Encode constants into `scripts/regime/phase0_regime_constants.json`\n"
        "- Replace bootstrap thresholds in `calc_regime_replay.py`\n\n"
        "## Raw grep capture\n"
        f"- See `{RAW_OUT.name}`\n",
        encoding="utf-8",
    )

    print(f"Wrote: {RAW_OUT}")
    print(f"Wrote: {CURATED_OUT}")


if __name__ == "__main__":
    main()
